//! The layer under the pipeline's model call (phase X7, `docs/AI-POST.md` §8.1): what runs the
//! model on one tile of one attempt. The pipeline of [`super::post`] (plan, tiles, the model, the
//! guard, the retries) calls a [`ModelBackend`] and does not know what is behind it:
//!
//! * [`LocalRuntime`]: stable-diffusion.cpp's `sd-server` on this computer (phases X3b, X3c), as
//!   it always ran: the same job, the same progress, the same errors.
//! * [`super::remote::RemoteApi`]: a remote image-to-image API, called with the system's `curl`.
//!
//! Every image a backend returns goes through the same guard of `rt-post`, with the same
//! protections and the same report; the interface's `AiModelBackend` (`src/core/ai-backend.ts`)
//! says the same thing on the page.

use super::png;
use super::remote::RemoteError;
use super::sidecar::{Job as SidecarJob, Progress, Sidecar, SidecarError, Stage};
use super::ModelRun;
use rt_post::{Rgb8Image, Tile};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// One model pass: one tile of one attempt, as the guard prepared it.
pub struct TilePass<'a> {
    /// 1-based tile, of `tiles`.
    pub tile: u32,
    /// Tiles of the plan.
    pub tiles: u32,
    /// The tile's rectangle and padded size.
    pub rect: &'a Tile,
    /// The engine image as the person sees it: 8-bit sRGB, the padded size.
    pub input: &'a Rgb8Image,
    /// `input` as PNG in base64 (what the local runtime takes).
    pub input_b64: &'a str,
    /// The control image for the local runtime (PNG in base64), when its family loads one.
    pub control_b64: Option<&'a str>,
    /// The passes for a remote API that is sent them: edges and depth, a byte a pixel.
    pub passes: Option<(&'a [u8], &'a [u8])>,
    /// The prompt and the negative prompt.
    pub prompt: &'a str,
    /// The negative prompt.
    pub negative: &'a str,
    /// The attempt's img2img strength.
    pub strength: f32,
    /// The seed.
    pub seed: u32,
}

/// Why a pass failed.
#[derive(Debug)]
pub enum BackendError {
    /// The local runtime's failure, as it always was.
    Local(SidecarError),
    /// The remote API's failure (its code is one of `API_ERRORS` of `src/core/ai-remote.ts`).
    Remote(RemoteError),
}

impl BackendError {
    /// Stopped by the person.
    pub fn is_cancel(&self) -> bool {
        matches!(
            self,
            BackendError::Local(SidecarError::Cancelled)
                | BackendError::Remote(RemoteError {
                    code: "cancelled",
                    ..
                })
        )
    }

    /// An image of another size than asked (the guard's size check rejects it): its size.
    pub fn wrong_size(&self) -> Option<(u32, u32)> {
        match self {
            BackendError::Local(SidecarError::WrongSize { got, .. }) => Some(*got),
            _ => None,
        }
    }

    /// The code the post's state carries.
    pub fn code(&self) -> &'static str {
        match self {
            BackendError::Local(e) => e.code(),
            BackendError::Remote(e) => e.code,
        }
    }

    /// In words, for the log and the page (never a key).
    pub fn message(&self) -> String {
        match self {
            BackendError::Local(e) => e.message(),
            BackendError::Remote(e) => e.message.clone(),
        }
    }
}

/// What runs the model.
pub trait ModelBackend: Send + Sync {
    /// What ran it, as the report says (`GuardReport.runtime`): an `ai-runtimes.json` key, or
    /// `api:<host>`.
    fn runtime(&self) -> &str;

    /// The model runs elsewhere: the render leaves this computer.
    fn is_remote(&self) -> bool {
        false
    }

    /// Wants the passes of every tile (a remote API that is sent them).
    fn wants_passes(&self) -> bool {
        false
    }

    /// The control image the local runtime loads (its kind), if any.
    fn control_kind(&self) -> Option<&str> {
        None
    }

    /// Runs the model on one tile. `progress` hears where it is; `cancel` stops it.
    fn run(
        &self,
        pass: &TilePass<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Rgb8Image, BackendError>;
}

/// The local runtime: the `sd-server` of X3b with the model prepared for the post.
pub struct LocalRuntime {
    /// The server.
    pub sidecar: Arc<Sidecar>,
    /// How the model is run.
    pub run: ModelRun,
}

/// A tile's PNG back as 8-bit RGB, bounded by the tile's padded size.
fn decode_tile(bytes: &[u8], tile: &Tile) -> Result<Rgb8Image, SidecarError> {
    let img = png::decode(
        bytes,
        u64::from(tile.padded_width) * u64::from(tile.padded_height),
    )
    .map_err(|e| SidecarError::BadImage(e.to_string()))?;
    Ok(Rgb8Image {
        width: img.width,
        height: img.height,
        rgb: png::rgb_of(&img),
    })
}

impl ModelBackend for LocalRuntime {
    fn runtime(&self) -> &str {
        &self.run.runtime
    }

    fn control_kind(&self) -> Option<&str> {
        self.run.control.as_ref().map(|(k, _)| k.as_str())
    }

    fn run(
        &self,
        pass: &TilePass<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Rgb8Image, BackendError> {
        let run = &self.run;
        let job = SidecarJob {
            prompt: pass.prompt.to_string(),
            negative: pass.negative.to_string(),
            width: pass.rect.padded_width,
            height: pass.rect.padded_height,
            strength: f64::from(pass.strength),
            seed: u64::from(pass.seed),
            steps: run.steps,
            cfg_scale: run.cfg_scale,
            sampler: run.sampler.clone(),
            flow_shift: run.flow_shift,
            image_b64: pass.input_b64.to_string(),
            as_reference: run.as_reference,
            control: match (pass.control_b64, &run.control) {
                (Some(img), Some((_, s))) => Some((img.to_string(), *s)),
                _ => None,
            },
        };
        // Every tile says it started (a quick one may end between two looks at the runtime):
        // loading while the model is not the one loaded, else inference.
        let loaded = self.sidecar.info().label.as_deref() == Some(run.spec.label.as_str());
        progress(Progress {
            stage: if loaded {
                Stage::Queued
            } else {
                Stage::Loading
            },
            step: 0,
            steps: 0,
        });
        let bytes = self
            .sidecar
            .run(&run.spec, &job, cancel, progress)
            .map_err(BackendError::Local)?;
        decode_tile(&bytes, pass.rect).map_err(BackendError::Local)
    }
}
