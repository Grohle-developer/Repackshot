# Licencias de los modelos de IA (X1 parte A)

Citas literales en su idioma original, leídas el 2026-10-13 y fijadas al *commit* de cada repositorio. Las preparó Sonnet en X1 parte A y las confirmó el líder; el comentario se deja en inglés tal como se redactó. Los datos que las usan están en `src/data/ai-models.json`.

---


All texts below were read on **2026-10-13**. Every Hugging Face URL is pinned to the commit used in
`ai-models.json`, so the quoted text can be re-read exactly. GitHub URLs point to `main` (the sandbox
proxy blocks the GitHub API, so no commit could be resolved); they were fetched through
`raw.githubusercontent.com` on the same date.

SPDX note: CreativeML OpenRAIL-M has no SPDX identifier. `ai-models.json` uses
`LicenseRef-CreativeML-OpenRAIL-M` (the valid SPDX form for an unlisted licence). Change it in one place
if the app prefers another string.

Summary

| Key | Model licence | Commercial use | Use restrictions | Any component under another licence? |
| --- | --- | --- | --- | --- |
| ZIMAGE_Q8 / Q4 / Q2 | Apache-2.0 | yes | no | no (text encoder Apache-2.0, VAE Apache-2.0) |
| ZIMAGE_WEB | Apache-2.0 | yes | no | no (the optional safety checker, which is NOT included, has no stated licence) |
| KLEIN4B_Q4 | Apache-2.0 | yes | no (card carries a non-binding acceptable-use list) | no, but the FLUX.2 VAE lives in a repository under a non-commercial licence (see 4) |
| QWENEDIT_Q4 | Apache-2.0 | yes | no | no |
| SD15_LIGHT | CreativeML OpenRAIL-M | yes | **yes** (Attachment A, must be passed on) | ControlNet files: OpenRAIL-M too; the fp16 mirror states no licence at all |

No default model is noncommercial. `ZIMAGE_Q8` (the only `default: true`) is Apache-2.0 end to end.

---

## 1. Z-Image-Turbo (ZIMAGE_Q8, ZIMAGE_Q4, ZIMAGE_Q2)

Components: transformer `leejet/Z-Image-Turbo-GGUF`, text encoder `Qwen/Qwen3-4B-GGUF`, VAE
`Comfy-Org/z_image_turbo` (`split_files/vae/ae.safetensors`).

**Base model (Tongyi-MAI).**
- HF card metadata, `license: apache-2.0`
  (https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/blob/f332072aa78be7aecdf3ee76d5c247082da564a6/README.md, line 2).
  The HF repository has no LICENSE file.
- GitHub LICENSE is the Apache License 2.0 (https://raw.githubusercontent.com/Tongyi-MAI/Z-Image/main/LICENSE):
  > 2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

  > 4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions: (a) You must give any other recipients of the Work or Derivative Works a copy of this License; and (b) You must cause any modified files to carry prominent notices stating that You changed the files; [...]

  No field-of-use or commercial restriction anywhere in the text.

**Quantised GGUF (leejet, the author of stable-diffusion.cpp).**
- https://huggingface.co/leejet/Z-Image-Turbo-GGUF/blob/c61c0e422dc8b541b7548cf33a4ef8302b0f8085/README.md
  > license: apache-2.0
  > The license of the quantized files follows the license of the original model:
  >  - Z-Image-Turbo: apache-2.0

  Same licence as the base model. No contradiction.

**Text encoder (Qwen/Qwen3-4B-GGUF, official Qwen repo).**
- Card front matter: `license: apache-2.0`, `license_link: https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/main/LICENSE`
  (https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/README.md).
- LICENSE file (https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE) is the
  unmodified Apache License 2.0 text (same section 2 wording as quoted above).

**VAE (Comfy-Org/z_image_turbo, `ae.safetensors`).**
- Card: `license: apache-2.0`, `base_model: Tongyi-MAI/Z-Image-Turbo`
  (https://huggingface.co/Comfy-Org/z_image_turbo/blob/6fc90a3b1b653e935a0d175e260736de25b84df5/README.md).
- The file is the FLUX.1 autoencoder. Its git blob id (`71f11a92800c4a93cead7cebc556531926ecfc33`) and size
  (335 304 388 B) are identical to `ae.safetensors` in `black-forest-labs/FLUX.1-schnell`, so the bytes (and the
  sha256) are the same. FLUX.1-schnell card
  (https://huggingface.co/black-forest-labs/FLUX.1-schnell/blob/741f7c3ce8b383c54771c7003378a50191e9efe9/README.md):
  > license: apache-2.0
  > 3. Released under the `apache-2.0` licence, the model can be used for personal, scientific, and commercial purposes.

  FLUX.1-schnell itself is gated (`gated: auto`) and masks its LFS hashes; the Comfy-Org copy is ungated.

## 2. Z-Image-Turbo web (ZIMAGE_WEB)

Repository `webnn/Z-Image-Turbo` (ONNX q4f16 export for ONNX Runtime Web with WebGPU/WebNN).
- Card (https://huggingface.co/webnn/Z-Image-Turbo/blob/02e1d8cc5d10d9ff6c7ed1f54b173bd981381bc2/README.md):
  > license: apache-2.0
  > This repository provides an optimized ONNX version of **Tongyi-MAI/Z-Image-Turbo**, specifically tailored for efficient browser execution via **WebNN** and **WebGPU** using ONNX Runtime Web.

  Derivative of the Apache-2.0 base model; consistent with it.
- The older sibling repo `webnn/Z-Image-Turbo-Archive` (not used) says
  (https://huggingface.co/webnn/Z-Image-Turbo-Archive/blob/451f136ee175b0d36b26d45bac030460c159c0e6/README.md):
  > This [Z-Image Turbo] model is licensed under the [Apache license 2.0]. If you comply with the license and terms of use, you have the rights described therin. By using this Model, you accept the terms.
  > Z-Image-Turbo is meant to be used with the corresponding sample [here](https://microsoft.github.io/webnn-developer-preview/) for educational or testing purposes only.

  The "educational or testing purposes only" sentence is **not** in the current `webnn/Z-Image-Turbo` card, and it
  is not a licence term (the licence stays Apache-2.0), but it is an intent statement by the publisher. Flagged in
  `report.md`.
- The exporter scripts in `model_exporter/` carry "Licensed under the MIT License" (Microsoft) with Intel
  modifications. They are code, not weights, and are **not** in the file list.
- Tokenizer files (Qwen3 tokenizer) are Apache-2.0 (Qwen).
- The repo also ships `safety_checker_model_f16.onnx*` and `sc_prep_model_f16.onnx` (derived from
  `CompVis/stable-diffusion-safety-checker`, whose HF card states no licence: `cardData.license` is empty). These are
  **excluded** from the file list for that reason (and because they are 608 MB the product does not need).

## 3. Qwen3-4B text encoder as used by Klein (KLEIN4B_Q4)

Same file as in section 1 (`Qwen/Qwen3-4B-GGUF`, Q4_K_M, Apache-2.0). FLUX.2 [klein] 4B's own text encoder has the
same architecture (Qwen3ForCausalLM, 36 layers, hidden 2560, vocab 151 936) and the Comfy-Org `qwen_3_4b.safetensors`
used by both Z-Image and Klein repackaging is the same file (sha256 `6c671498573ac2f7...` in both repos).

## 4. FLUX.2 [klein] 4B (KLEIN4B_Q4)

**Base model (Black Forest Labs).**
- https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/README.md
  > license: apache-2.0
  > Fully open under Apache 2.0. [...] Built for local development, edge deployment, and production use.
  > 5. Open weights available for commercial use under the [Apache 2.0 license](https://www.apache.org/licenses/LICENSE-2.0).
  > License
  > This model is licensed under the https://www.apache.org/licenses/LICENSE-2.0.
- LICENSE.md in that repo is the Apache License 2.0 text
  (https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/LICENSE.md).
  This is the URL used in `ai-models.json`.
- BFL's repo README (https://raw.githubusercontent.com/black-forest-labs/flux2/main/README.md):
  > **Licensing:** 4B models are [Apache 2.0]. 9B models use the [FLUX.2-dev Non-Commercial License].
- Acceptable-use list in the card (not a licence term; the card says so itself):
  > The model and its derivatives may not be used: - In any way that violates applicable law; - For the purpose of exploiting, harming or attempting to exploit or harm minors in any way; [...] - To create non-consensual intimate imagery or illegal pornographic content. [...]
  > Nothing contained in this Model Card should be interpreted as or deemed a restriction or modification to the license the model is released under.

  So `useRestrictions` stays `false`. The UI may still want to show this list as an acceptable-use note.

**Quantised GGUF (unsloth, Q4_K_M; leejet publishes only Q4_0 and Q8_0).**
- https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/blob/0084d1df98e2e2137fe776d55170bc4792ec1d66/README.md
  > license: apache-2.0
  > License
  > This model is licensed under the https://www.apache.org/licenses/LICENSE-2.0.

  Its LICENSE.md is byte-identical to BFL's (checked with `cmp`). Same licence as the base. The card also says
  "Fully open under Apache 2.0 [...] Open weights available for commercial use under the Apache 2.0 license".

**VAE (Comfy-Org/vae-text-encorder-for-flux-klein-4b, `flux2-vae.safetensors`) , the one licence-sensitive file.**
- Card: `license: apache-2.0` (https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/blob/5f526678002e43af5551dadb73ce2e8c91b43afe/README.md).
- The file is byte-identical to `ae.safetensors` in `black-forest-labs/FLUX.2-dev` (same git blob id
  `78f8fcf4adb004763e3335b937a9d7a6dfa9f5b5`, same size 336 211 292 B; FLUX.2-dev masks its LFS hash because it is gated).
- `black-forest-labs/FLUX.2-dev` is **gated** and its HF licence is `other` / `flux-non-commercial-license`. The
  autoencoder is declared Apache-2.0 separately, by BFL in its GitHub README
  (https://raw.githubusercontent.com/black-forest-labs/flux2/main/README.md):
  > ## `FLUX.2` autoencoder
  > The FLUX.2 autoencoder has considerably improved over the [FLUX.1 autoencoder]. The autoencoder is released under [Apache 2.0] and can be found [here](https://huggingface.co/black-forest-labs/FLUX.2-dev/blob/main/ae.safetensors).
- An independent mirror repeats it (unsloth/FLUX.2-VAE NOTICE): "The FLUX.2 autoencoder is Copyright Black Forest Labs Inc. and is licensed under the Apache License, Version 2.0. Unlike the rest of FLUX.2 [dev], it is NOT under the FLUX Non-Commercial License."
- Residual risk: the declaration is a single README sentence on GitHub, while the HF repo that hosts the original
  file is non-commercial. The model card of the Apache-2.0 klein 4B repo does not restate it. See `report.md`
  (open question) for an Apache-clean alternative source.

## 5. Qwen-Image-Edit-2511 (QWENEDIT_Q4)

**Base model (Qwen).**
- https://huggingface.co/Qwen/Qwen-Image-Edit-2511/blob/6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9/README.md
  > license: apache-2.0
  > ## License Agreement
  > Qwen-Image is licensed under Apache 2.0.
- GitHub LICENSE is Apache 2.0 (https://raw.githubusercontent.com/QwenLM/Qwen-Image/main/LICENSE), used as
  `licence.url`. The HF repo has no LICENSE file.

**Quantised GGUF (unsloth).**
- https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF/blob/0d33d9692b4b26212297240d87b0d4719aa4fd06/README.md
  > license: apache-2.0
  > ## License Agreement
  > Qwen-Image is licensed under Apache 2.0.

  Same licence as the base.

**Text encoder + projector (ggml-org/Qwen2.5-VL-7B-Instruct-GGUF).**
- Card (https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/blob/508edd0afaa66bb9e9f40587acc2184f02daf1f6/README.md):
  > license: apache-2.0
  > base_model: Qwen/Qwen2.5-VL-7B-Instruct
- Base `Qwen/Qwen2.5-VL-7B-Instruct` card: `license: apache-2.0`
  (https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct/blob/cc594898137f460bfe9f0759e9844b3ce807cfb5/README.md);
  GitHub LICENSE is Apache 2.0 (https://raw.githubusercontent.com/QwenLM/Qwen2.5-VL/main/LICENSE). The 7B size is
  Apache-2.0 (the 3B and 72B sizes of Qwen2.5-VL are not, so do not swap size).

**VAE (Comfy-Org/Qwen-Image_ComfyUI, `qwen_image_vae.safetensors`).**
- Card: `license: apache-2.0`, base_model `Qwen/Qwen-Image`
  (https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/1f12b17be14c89b026c51a91d67c32f84bb047bc/README.md).

## 6. Stable Diffusion 1.5 + ControlNet 1.1 tile and depth (SD15_LIGHT)

**CreativeML Open RAIL-M** (text: https://huggingface.co/spaces/CompVis/stable-diffusion-license , raw
`license.txt`, dated August 22, 2022). Relevant lines, verbatim:

- Commercial use is allowed; the grant has no field-of-use limit (Section II):
  > 2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare, publicly display, publicly perform, sublicense, and distribute the Complementary Material, the Model, and Derivatives of the Model.
- Output (Section III, 6):
  > 6. The Output You Generate. Except as set forth herein, Licensor claims no rights in the Output You generate using the Model. You are accountable for the Output you generate and its subsequent uses. No use of the output can contravene any provision as stated in the License.
- The restrictions must be passed on and notified (Section III, 4):
  > Use-based restrictions as referenced in paragraph 5 MUST be included as an enforceable provision by You in any type of legal agreement (e.g. a license) governing the use and/or distribution of the Model or Derivatives of the Model, and You shall give notice to subsequent users You Distribute to, that the Model or Derivatives of the Model are subject to paragraph 5.
  > You must give any Third Party recipients of the Model or Derivatives of the Model a copy of this License;
- Use-based restrictions (Section III, 5):
  > 5. Use-based restrictions. The restrictions set forth in Attachment A are considered Use-based restrictions. Therefore You cannot use the Model and the Derivatives of the Model for the specified restricted uses. [...] You shall require all of Your users who use the Model or a Derivative of the Model to comply with the terms of this paragraph (paragraph 5).
- Attachment A, "You agree not to use the Model or Derivatives of the Model:"
  - In any way that violates any applicable national, federal, state, local or international law or regulation;
  - For the purpose of exploiting, harming or attempting to exploit or harm minors in any way;
  - To generate or disseminate verifiably false information and/or content with the purpose of harming others;
  - To generate or disseminate personal identifiable information that can be used to harm an individual;
  - To defame, disparage or otherwise harass others;
  - For fully automated decision making that adversely impacts an individual's legal rights or otherwise creates or modifies a binding, enforceable obligation;
  - For any use intended to or which has the effect of discriminating against or harming individuals or groups based on online or offline social behavior or known or predicted personal or personality characteristics;
  - To exploit any of the vulnerabilities of a specific group of persons based on their age, social, physical or mental characteristics, in order to materially distort the behavior of a person pertaining to that group in a manner that causes or is likely to cause that person or another person physical or psychological harm;
  - For any use intended to or which has the effect of discriminating against individuals or groups based on legally protected characteristics or categories;
  - To provide medical advice and medical results interpretation;
  - To generate or disseminate information for the purpose to be used for administration of justice, law enforcement, immigration or asylum processes, such as predicting an individual will commit fraud/crime commitment (e.g. by text profiling, drawing causal relationships between assertions made in documents, indiscriminate and arbitrarily-targeted use).
- Section IV, 7 (remote restriction / updates), relevant to a product that downloads and runs the model:
  > 7. Updates and Runtime Restrictions. To the maximum extent permitted by law, Licensor reserves the right to restrict (remotely or otherwise) usage of the Model in violation of this License, update the Model through electronic means, or modify the Output of the Model based on updates. You shall undertake reasonable efforts to use the latest version of the Model.

`useRestrictions: true`, `commercialUse: true`. The app must show Attachment A and obtain acceptance before the
download (matches `AI-POST.md` §2.4 "restricciones de uso que se muestran y se aceptan").

**Base checkpoint** (`Comfy-Org/stable-diffusion-v1-5-archive`, `v1-5-pruned-emaonly-fp16.safetensors`).
- Card (https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/blob/9cfd069101959ca3828bf9c04a4419870832b74f/README.md):
  > license: creativeml-openrail-m
  > This is an archival re-upload of Stable Diffusion v1.5, originally at https://huggingface.co/runwayml/stable-diffusion-v1-5 until RunwayML took down that page.
  > [v1-5-pruned-emaonly.safetensors] is the exact original hash-identical model as uploaded by RunwayML.
  > [v1-5-pruned-emaonly-fp16.safetensors] is that model converted to FP16, with a metadata header added.
- The other usual mirror (`stable-diffusion-v1-5/stable-diffusion-v1-5`, card `license: creativeml-openrail-m`) says:
  > This repository is a mirror of the now deprecated `ruwnayml/stable-diffusion-v1-5`, this repository or organization are not affiliated in any way with RunwayML.
  
  Chain of custody: the original licensors (Runway, CompVis, Stability AI) no longer host it; both mirrors are
  third parties. The fp16 file is a **conversion** by Comfy-Org (not the licensor's bytes). OpenRAIL-M permits
  derivatives and redistribution under the same use restrictions, so there is no licence conflict, but note it.

**ControlNet 1.1 tile and depth** (`comfyanonymous/ControlNet-v1-1_fp16_safetensors`).
- The fp16 repo has **no licence metadata** (`cardData.license` empty) and a README of two sentences
  (https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors/blob/ab830a51c5c573a5b85bfdbaa3ae0ab7e1baf5f7/README.md):
  > Safetensors/FP16 versions of the new [ControlNet-v1-1](https://huggingface.co/lllyasviel/ControlNet-v1-1) checkpoints.
- The originals by lllyasviel declare, for tile
  (https://huggingface.co/lllyasviel/control_v11f1e_sd15_tile/blob/3f877705c37010b7221c3d10743307d6b5b6efac/README.md)
  and depth (https://huggingface.co/lllyasviel/control_v11f1p_sd15_depth/blob/539f99181d33db39cf1af2e517cd8056785f0a87/README.md):
  > license: openrail
  > - **License:** [The CreativeML OpenRAIL M license](https://huggingface.co/spaces/CompVis/stable-diffusion-license) is an [Open RAIL M license](https://www.licenses.ai/blog/2022/8/18/naming-convention-of-responsible-ai-licenses), adapted from the work that [BigScience](https://bigscience.huggingface.co/) and [the RAIL Initiative](https://www.licenses.ai/) are jointly carrying in the area of responsible AI licensing.

  Both ControlNet files are therefore recorded as OpenRAIL-M (`LicenseRef-CreativeML-OpenRAIL-M`), by inheritance
  from lllyasviel's cards, not from the repo actually downloaded from. This is the weakest licence trail of the set.

---

## Non-selected components worth knowing about (not in the JSON)

- Z-Image ControlNet: `alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1` , card `license: apache-2.0`, ungated,
  6 712 485 600 B per file (bf16 safetensors, no GGUF). Not part of any row of `AI-POST.md` §2.4.
- `black-forest-labs/FLUX.2-dev` (non-commercial, gated), `FLUX.1-schnell` (Apache-2.0, gated=auto): only used as
  originals of the two VAEs; the app downloads from the ungated Comfy-Org copies.
- `CompVis/stable-diffusion-safety-checker`: no licence stated on HF; excluded (see section 2).
