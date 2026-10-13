//! The C ABI driven like a host would, against `rt_post::run` called directly.

#![allow(unsafe_code)] // The tests call the unsafe C ABI exactly like a host would.

use super::*;
use crate::ffi::*;
use rt_post::{run, MaterialInfo, Settings, TileRequest};

/// The registry is process-wide state: tests that touch it run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
}

const W: u32 = 48;
const H: u32 = 20;

/// Two parts on a grey background: a warm block (wear) and a blue one.
fn scene() -> (LinearImage, Vec<u32>, Vec<u32>, Vec<f32>) {
    let mut image = LinearImage::new(W, H);
    let mut part = vec![0u32; (W * H) as usize];
    let mut normal = vec![0.0f32; (W * H * 3) as usize];
    for y in 0..H {
        for x in 0..W {
            let p = (y * W + x) as usize;
            let (id, c) = if (4..20).contains(&x) && (3..17).contains(&y) {
                (1, [0.6, 0.3, 0.2])
            } else if (26..44).contains(&x) && (5..15).contains(&y) {
                (2, [0.1, 0.2, 0.5])
            } else {
                (0, [0.3, 0.3, 0.3])
            };
            let shade = 0.8 + 0.01 * ((x * 7 + y * 13) % 17) as f32;
            part[p] = id;
            if id != 0 {
                normal[p * 3 + 2] = 1.0;
            }
            for (k, v) in c.iter().enumerate() {
                image.rgba[p * 4 + k] = v * shade;
            }
            image.rgba[p * 4 + 3] = 1.0;
        }
    }
    let material = part.clone();
    (image, part, material, normal)
}

fn job() -> Job {
    let mut job = Job::new(W, H, Settings::DEFAULT);
    job.materials = vec![
        MaterialInfo {
            id: 1,
            name: "Warm".into(),
            allows_wear: true,
            locked: false,
        },
        MaterialInfo {
            id: 2,
            name: "Blue".into(),
            allows_wear: false,
            locked: false,
        },
    ];
    job.model_key = "ZIMAGE_Q4".into();
    job.runtime = "synthetic".into();
    job
}

/// A model that brightens everything a little and returns `extra` more columns when asked to.
fn model(input: &[u8], extra: u32, width: u32, height: u32) -> (u32, Vec<u8>) {
    let mut out = Vec::new();
    for j in 0..height {
        for i in 0..width + extra {
            for c in 0..3 {
                let v = input[((j * width + i.min(width - 1)) * 3 + c) as usize];
                out.push(v.saturating_add(6 + (i % 5) as u8));
            }
        }
    }
    (width + extra, out)
}

fn upload(bytes: &[u8]) -> *mut u8 {
    let ptr = post_alloc(bytes.len() as u32);
    // SAFETY: `ptr` points to `bytes.len()` writable bytes just allocated by `post_alloc`.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
    ptr
}

fn read(ptr: *const u8, len: usize) -> Vec<u8> {
    // SAFETY: the caller allocated `len` readable bytes at `ptr`.
    unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
}

fn last_text() -> String {
    let len = post_text_len();
    let buf = post_alloc(len);
    // SAFETY: `buf` has room for the `len` text bytes.
    unsafe { post_text_copy(buf) };
    let text = String::from_utf8(read(buf, len as usize)).unwrap();
    // SAFETY: `buf` came from `post_alloc(len)`.
    unsafe { post_free(buf, len) };
    text
}

fn u32_bytes(v: &[u32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// Runs a whole job through the C ABI; returns the outcome JSON and the delivered image.
fn drive(job: &Job, extra: u32) -> (String, Vec<f32>) {
    let (image, part, material, normal) = scene();
    let bytes = job.to_bytes();
    let ptr = upload(&bytes);
    // SAFETY: `ptr` holds `bytes.len()` initialised bytes from `post_alloc`.
    let handle = unsafe { post_open(ptr, bytes.len() as u32) };
    // SAFETY: freed once with its length.
    unsafe { post_free(ptr, bytes.len() as u32) };
    assert_ne!(handle, 0, "{}", String::from_utf8_lossy(&error_message()));
    let plan = last_text();
    assert!(
        plan.starts_with("{\"width\":48,\"height\":20,\"tiles\":[{"),
        "{plan}"
    );

    let img = upload(&f32_bytes(&image.rgba));
    let (pp, mp, np) = (
        upload(&u32_bytes(&part)),
        upload(&u32_bytes(&material)),
        upload(&f32_bytes(&normal)),
    );
    // SAFETY: every buffer holds its full plane; null passes are explicitly allowed.
    unsafe {
        assert_eq!(post_set_image(handle, img, W, H), STATUS_OK);
        let null = std::ptr::null();
        assert_eq!(
            post_set_passes(handle, W, H, pp, mp, np, null, null),
            STATUS_OK
        );
    }
    let (pw, ph) = (48u32, 32u32); // 48 x 20 pads to 48 x 32
    let mut attempt = 0;
    loop {
        let input = post_alloc(pw * ph * 3);
        let edges = post_alloc(pw * ph);
        // SAFETY: both buffers have room for the padded tile.
        unsafe {
            assert_eq!(post_tile_input(handle, 0, input), STATUS_OK);
            assert_eq!(
                post_tile_control(handle, 0, CONTROL_EDGES, edges),
                STATUS_OK
            );
        }
        let edge_bytes = read(edges, (pw * ph) as usize);
        assert_eq!(
            edge_bytes[(3 * pw + 4) as usize],
            255,
            "the warm block's corner"
        );
        assert_eq!(edge_bytes[(10 * pw + 10) as usize], 0);
        let (ow, out) = model(&read(input, (pw * ph * 3) as usize), extra, pw, ph);
        let optr = upload(&out);
        // SAFETY: `optr` holds `ow * ph * 3` bytes; the other buffers are freed once each.
        unsafe {
            assert_eq!(post_set_output(handle, 0, ow, ph, optr), STATUS_OK);
            post_free(optr, out.len() as u32);
            post_free(input, pw * ph * 3);
            post_free(edges, pw * ph);
        }
        match post_accept(handle, attempt) {
            OUTCOME_RETRY => attempt += 1,
            OUTCOME_ACCEPTED | OUTCOME_REJECTED => break,
            other => panic!(
                "accept: {other} {}",
                String::from_utf8_lossy(&error_message())
            ),
        }
    }
    let text = last_text();
    let res = post_alloc(W * H * 16);
    // SAFETY: `res` has room for the whole image; all buffers are freed once.
    let result = unsafe {
        assert_eq!(post_result(handle, res), STATUS_OK);
        let r = f32s(&read(res, (W * H * 16) as usize));
        post_free(res, W * H * 16);
        post_free(img, W * H * 16);
        post_free(pp, W * H * 4);
        post_free(mp, W * H * 4);
        post_free(np, W * H * 12);
        r
    };
    assert_eq!(post_close(handle), STATUS_OK);
    (text, result)
}

/// The same job through `rt_post::run`.
fn direct(job: &Job, extra: u32) -> (String, Vec<f32>) {
    let (image, part, material, normal) = scene();
    let passes = Passes {
        width: W,
        height: H,
        part_id: &part,
        material_id: &material,
        normal: Some(&normal),
        depth: None,
        coc: None,
    };
    let (out, report) = run(job, &image, &passes, |r: &TileRequest| {
        let (w, rgb) = model(&r.input.rgb, extra, r.input.width, r.input.height);
        Rgb8Image {
            width: w,
            height: r.input.height,
            rgb,
        }
    })
    .unwrap();
    (report.to_json(), out.rgba)
}

#[test]
fn the_c_abi_gives_what_the_library_gives() {
    let _guard = serial();
    for extra in [0u32, 16] {
        let (text, image) = drive(&job(), extra);
        let (report, want) = direct(&job(), extra);
        let verdict = if extra == 0 { "ACCEPTED" } else { "REJECTED" };
        assert_eq!(
            text,
            format!("{{\"outcome\":\"{verdict}\",\"report\":{report}}}")
        );
        assert!(image
            .iter()
            .zip(&want)
            .all(|(a, b)| a.to_bits() == b.to_bits()));
        if extra == 16 {
            assert_eq!(
                image,
                scene().0.rgba,
                "a rejection delivers the engine image"
            );
        }
    }
}

#[test]
fn intervention_zero_has_no_tiles_and_returns_the_input() {
    let _guard = serial();
    let mut job = job();
    job.settings.intervention = 0;
    let handle = open(&job.to_bytes());
    assert!(String::from_utf8(text()).unwrap().contains("\"tiles\":[]"));
    let (image, part, material, _) = scene();
    assert_eq!(set_image(handle, &f32_bytes(&image.rgba), W, H), STATUS_OK);
    let passes = PassBytes {
        width: W,
        height: H,
        part: &u32_bytes(&part),
        material: &u32_bytes(&material),
        normal: None,
        depth: None,
        coc: None,
    };
    assert_eq!(set_passes(handle, passes), STATUS_OK);
    assert_eq!(accept_attempt(handle, 0), OUTCOME_ACCEPTED);
    assert_eq!(result_bytes(handle).unwrap(), f32_bytes(&image.rgba));
    assert_eq!(tile_input_bytes(handle, 0), Err(STATUS_BAD_ARGUMENT));
    close(handle);
}

#[test]
fn bad_calls_return_status_codes() {
    let _guard = serial();
    assert_eq!(open(b"nope"), 0);
    assert!(!error_message().is_empty());
    // SAFETY: a null pointer is explicitly handled.
    assert_eq!(unsafe { post_open(std::ptr::null(), 4) }, 0);
    let handle = open(&job().to_bytes());
    assert_ne!(handle, 0);
    assert!(error_message().is_empty());
    assert_eq!(set_image(handle, &[0; 16], 1, 1), STATUS_BAD_ARGUMENT);
    assert_eq!(set_image(handle + 9, &[0; 16], 1, 1), STATUS_BAD_HANDLE);
    assert_eq!(accept_attempt(handle, 0), OUTCOME_ERROR + STATUS_MISSING);
    assert_eq!(tile_input_bytes(handle, 0), Err(STATUS_MISSING));
    assert_eq!(tile_control_bytes(handle, 0, 0), Err(STATUS_MISSING));
    assert_eq!(set_output(handle, 0, 2, 2, &[0; 5]), STATUS_BAD_ARGUMENT);
    assert_eq!(set_output(handle, 7, 2, 2, &[0; 12]), STATUS_BAD_ARGUMENT);
    let short = PassBytes {
        width: W,
        height: H,
        part: &[0; 8],
        material: &[0; 8],
        normal: None,
        depth: None,
        coc: None,
    };
    assert_eq!(set_passes(handle, short), STATUS_INVALID);
    assert!(String::from_utf8(error_message())
        .unwrap()
        .contains("wrong size"));
    assert!(strength(handle, 0) > 0.0);
    assert!(strength(0, 0).is_nan());
    assert_eq!(result_bytes(handle), Err(STATUS_MISSING));
    // SAFETY: null pointers are explicitly handled.
    unsafe {
        assert_eq!(
            post_tile_input(handle, 0, std::ptr::null_mut()),
            STATUS_NULL_POINTER
        );
        assert_eq!(
            post_result(handle, std::ptr::null_mut()),
            STATUS_NULL_POINTER
        );
        post_free(std::ptr::null_mut(), 0);
    }
    assert_eq!(close(handle), STATUS_OK);
    assert_eq!(close(handle), STATUS_BAD_HANDLE, "double close is reported");
    assert_eq!(post_version(), rt_post::VERSION);
}
