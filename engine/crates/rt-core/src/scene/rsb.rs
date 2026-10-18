//! RSB: the Repackshot Scene Binary format, version 1.
//!
//! Everything is little-endian.
//!
//! ```text
//! file    = "RSB1" · u32 header_len · header_len extra header bytes · section*
//! section = [u8; 4] tag · u32 byte_len · payload (byte_len bytes)
//! ```
//!
//! `header_len` counts the bytes between the `header_len` field itself and the first section.
//! Version 1 writers emit 0 and readers skip whatever is there, so later versions can add header
//! fields. Tags are four ASCII bytes. **Unknown tags are skipped**, and a known section may carry
//! extra trailing bytes (newer writers append fields), so old readers keep working.
//!
//! Section payloads (`[3]` means three consecutive values; sizes are the minimum payload length;
//! fields after a `|` were appended later (E3, then `||` E5, `|||` X2, `||||` E5c, `|||||` E6
//! and E9, `||||||` M2b, `|||||||` E10, `||||||||` K3) and are
//! optional: a shorter payload, as older writers wrote it, reads them as their defaults, and the
//! writer always writes them, but those marked "only when set", which it adds only when one of them
//! is not its default):
//!
//! ```text
//! CAMR  60 B  f32 position[3] target[3] up[3]; f32 focal_mm sensor_mm fstop focus_dist;
//!             u32 ortho_flag; f32 ortho_width
//!             |||||||| u32 projection (0); f32 fov_x_deg (360) fov_y_deg (180) exterior (1)
//!                                                                  (K3, 76 B; only when set)
//! MESH  var.  u32 vertex_count index_count; f32 positions[3n] normals[3n]; u32 indices[m];
//!             u32 material_id                      (n = vertex_count, m = index_count)
//!             |||||| u32 uv_sets (0 to 2); f32 uv[2n] per set, v up            (M2b)
//! MATL  56 B  u32 kind; f32 base_color[3] metallic roughness ior transmission coat
//!             coat_roughness emission[3] emission_power | u32 flags (default 0)       (60 B)
//!             || f32 opacity (1) anisotropy (0) absorption_mm (0)                     (72 B)
//!             ||||| f32 bevel_mm (0)                                                  (76 B)
//!             scatter_mm (0) scatter_color[3] (1 1 1) scatter_g (0) abbe (0)          (100 B)
//!             |||||| the texture block from byte 100 (M2b): u32 version (1); 6 × slot
//!             (i32 image; u32 projection axis uv_set; f32 size_mm rotation_deg offset[2]
//!             repeat[2]; u32 wrap channel flags; f32 strength cutoff); f32 emission_tint[3];
//!             u32 label_count; label_count × (i32 image; f32 origin[3] u[3] v[3] normal[3]
//!             width_mm height_mm depth_mm roughness coat relief)
//! LGHT  76 B  u32 kind; f32 position[3] direction[3] up[3] size_x size_y color[3] power
//!             spread_deg angle_deg; u32 flags
//!             | u32 profile (none: 0xffffffff)      (L5, 80 B, written only for kind 5, IES)
//! ENVR  40 B  u32 kind; f32 floor horizon zenith strength rotation_deg background_color[3];
//!             u32 background_mode
//!             || u32 hdri_map (none) backplate_map (none) backplate_fit (0);
//!             f32 sky_turbidity (3) sun_azimuth_deg (0) sun_elevation_deg (45)
//!             backplate_rect[4] (0 0 1 1)                                          (80 B)
//!             |||| u32 sky_model (0 physical)                                      (84 B)
//! BMAP  16 B  u32 format width height byte_len; u8 data[byte_len]; zero padding to 4 (E5, new)
//! FLOR  20 B  u32 mode; f32 z; f32 color[3]                                        (E3, new)
//! RNDR  28 B  u32 width height max_samples seed; f32 max_seconds exposure_ev; u32 tonemap
//!             | u32 max_depth (default 8); f32 clamp_indirect (default 0)            (36 B)
//!             ||| u32 passes (default 0)                                            (40 B)
//!             |||| u32 denoise (0) caustic_photons (0); f32 caustic_radius (0)      (52 B)
//!             ||||| f32 denoise_strength (1)                                       (56 B)
//!             |||||| u32 pixel_filter (0) edge_supersample (1)                     (64 B)
//!             ||||||| u32 adaptive (0); f32 noise_threshold (0)    (E10, 72 B; only when set)
//! INST  60 B  u32 mesh_id; f32 transform[12] (rows of the 3x4 object-to-world matrix);
//!             u32 material_id; u32 flags (1 one-sided, 2 not cut by the section view,
//!             4 hidden to the camera: K3)
//! PATN 108 B  u32 material kind; f32 color_a[3] color_b[3] scale_mm params[16];
//!             u32 variant seed                                              (E6, new)
//! LENS  72 B  u32 blades; f32 roundness rotation_deg; u32 profile; f32 profile_param
//!             obstruction cats_eye squeeze shift_x_mm shift_y_mm tilt_deg tilt_axis_deg
//!             ca_amount swirl field_mm; u32 mask_kind mask_width mask_height;
//!             u8 mask[mask_width * mask_height]; zero padding to 4                 (O1, new)
//!             | (u32 kind; f32 grade tint[3] angle_deg; u32 points)[3]           (O3a, +84 B)
//!             || u32 surface_count (0: the thin lens); with surfaces: u32 stop focus_mode;
//!             f32 f_number_min magnification_base magnification_near distortion vignetting
//!             spherical breathing; u32 moving_count; (u32 surface; f32 base near)[moving_count];
//!             (u32 kind; f32 radius thickness nd vd semi_aperture; u32 coating;
//!             f32 conic a4 a6 a8 a10)[surface_count]                                      (O2)
//! IMGS   4 B  u32 count; per image u32 width height channels (1, 3 or 4) color_space (0 sRGB,
//!             1 linear); u8 rows[width·height·channels] from the top; zero padding to 4  (M2b, new)
//! PROG   4 B  u32 material; the material's program: the bytes of M3a's `encodeProgram`
//!             (u32 magic "RPGM" version instruction_count const_count image_count f_registers
//!             v_registers output_count; f32 absorption_mm; u32 flags; instructions[6 words];
//!             f32 consts; (u32 image srgb wrap)[image_count]; (u32 kind index)[output_count])
//!                                                                    (M3b, new; written last)
//! IESP   4 B  u32 byte_len; u8 file[byte_len]; zero padding to 4: an IES LM-63 file, as text
//!             (L5, new; `crate::ies`)
//! FXAM 128 B  an ambient effect (S4a, new): kind seed; f32 time; u32 count; f32
//!             region_centre[3] region_half[3] band[2] size_mm size_var; u32 shape; f32
//!             fall_speed fall_var wind[3] turbulence[3] cloud_centre[3] cloud_radius
//!             cloud_softness; u32 material_id; f32 tint_var; u32 flags; f32 streak
//!             | f32 gravity (1) energy (0) spin (0); u32 palette_count (0);
//!             f32 palette[4][3] (white)                                           (192 B)
//!             ||||||||| f32 mix[4] (0); f32 drop_tail (1.6) drop_tip (0.15) shape_var (0)
//!                                                     (S3, 228 B; only when set: rt_sim::params)
//! SECT  20 B  the section view (Q1, new, at most one, written after the FXAM sections): u32
//!             flags (bit 0: cap the cut solids); f32 normal[3] distance
//! GLAS  48 B  the front glass (S3, new, at most one, written right after LENS): u32 flags (0);
//!             f32 distance_mm; u32 seed; f32 drop_coverage drop_size_mm drop_size_var
//!             contact_angle_deg ior dust_coverage dust_size_mm dust_size_var dust_opacity
//!             | u32 layout (1); u32 drop_count mote_count; f32 (x y a)[drop_count]
//!             (x y r)[mote_count]     (S3b: the drops and motes one by one; only when there are)
//! WETP  24 B  the rain, dust and snow on an instance (S3c, new, at most one per instance, written
//!             after the INST sections): u32 instance triangles samples drops; f32 cap_angle_deg
//!             porosity; u8 resolution[triangles], zero padding to 4; u8 (wet dust snow)[samples],
//!             zero padding to 4; (u32 triangle; f32 x y z radius)[drops]
//! ```
//!
//! `CAMR`, `ENVR`, `FLOR`, `RNDR`, `LENS`, `IMGS`, `SECT` and `GLAS` may appear at most once (a missing one means
//! "defaults"; a missing `LENS` is the plain thin lens);
//! `MESH`, `MATL`, `LGHT`, `INST`, `BMAP`, `PATN`, `FXAM`, `IESP`, `PROG` and `WETP` repeat. A mesh refers to a material by its position
//! among the `MATL` sections, an instance to a mesh by its position among the `MESH` sections, the
//! environment to a bitmap by its position among the `BMAP` sections (`0xffffffff`: none),
//! wherever they are in the file. All floats must be finite.
//!
//! **Bitmaps** (E5). `BMAP.format` is 0 (8-bit sRGB RGB), 1 (8-bit sRGB RGBA, alpha ignored), 2
//! (little-endian linear `f32` RGB), 16 (a whole Radiance `.hdr` file) or 17 (a whole OpenEXR
//! file: scanline, uncompressed, RLE, ZIPS or ZIP); `width` and `height` are the size of the raw
//! formats and 0 (or the file's own size) for the files. Rows run top to bottom. See
//! [`crate::bitmap`]; a bitmap that cannot be decoded makes the file invalid.
//!
//! **Textures** (M2b, the contract M2a's writer follows: ARCHITECTURE §5.2). `IMGS` holds the
//! texture images ([`crate::texture::TextureImage`]: the engine computes their mipmaps); the
//! texture block of a `MATL` its six slots (colour, roughness, metal, normal, alpha, emission:
//! the image's index in `IMGS`, −1 none, and the mapping it uses), the emission tint and its labels
//! ([`crate::texture::MaterialTextures`]); the UV sets of a `MESH` its texture coordinates. A
//! block of another version than 1 is skipped (a newer file's); an unknown projection, axis, UV
//! set, wrap or channel, a size that is not positive, a label without a size, a truncated block,
//! more than two UV sets or one without a pair per vertex, an image index past `IMGS` or a bad
//! image make the file invalid. What they do in the shading: [`crate::texture`]. The writer
//! emits them as the page's writer does: when the scene has images or blocks (or
//! [`Scene::textured`]), every mesh gets its UV sets word, every material with a block its block,
//! and `IMGS` follows the `FXAM` sections.
//!
//! **Material programs** (M3b, ARCHITECTURE §5.2 quater and [`crate::program`]). A `PROG`
//! section is the compiled graph of the material `material` (its position among the `MATL`
//! sections; at most one per material, the first counts): the engine runs it at every hit of the
//! material's instances, and its values replace the material's there. A program of another
//! version than 1 is skipped (a newer file's: the material keeps its plain values); an unknown
//! opcode, a register, constant or image index out of range, a register read before it is
//! written, a destination that is an operand of its own instruction, a material program without
//! its fifteen outputs, a `material` that is not a `MATL`, or an image index that is not an `IMGS`
//! image of the program's colour space make the file invalid. A file without `PROG` reads (and a
//! scene without programs writes) exactly as before. The writer emits the `PROG` sections at the
//! end, and with them the meshes' UV sets (a program reads them).
//!
//! **Instances.** A file without `INST` sections draws every mesh once, untransformed, with the
//! mesh's own `material_id` (one implicit instance per mesh: what files written before `INST`
//! existed mean). A file with `INST` sections draws exactly the instances listed, in that order;
//! a mesh no instance refers to is not drawn. The writer emits `INST` only when the instances
//! differ from the implicit ones, so scenes without instancing keep their exact bytes.
//!
//! **Ambient effects** (S4a). Each `FXAM` section is the parameters of one effect, not its
//! particles: the field table and their meaning are those of [`rt_sim::params`] (millimetres,
//! seconds, mm/s; `flags` 1 seen by camera rays, 2 in reflections, 4 casts shadows). The reader
//! evaluates the particles ([`rt_sim`]) for the file's camera and image size and builds their
//! BVH ([`crate::geometry::ParticleSet`]); a reader without S4a skips the section. The effect's
//! `material_id` must refer to a `MATL` section. In the part and material id passes a particle
//! counts as instance `instances + effect index`.
//!
//! **Front glass** (S3). `GLAS` puts a pane in front of the camera, at `distance_mm` from its
//! position (0: where a front element sits), that drops of water and motes of dust lie on: the
//! fields and what the camera rays do through it are those of [`crate::optics::glass`]. The reader
//! lays the drops out for the file's camera ([`crate::optics::glass::FrontGlass`]); a pane with no
//! drop and no dust changes no pixel, and a file without `GLAS` is the camera as before S3. An
//! engine of before S3 skips the section (the page writes it only for an engine whose
//! [`crate::FEATURES`] say it draws it, [`crate::FEATURE_DROPS`]). **S3b** appends the drops and
//! motes listed one by one ([`crate::optics::glass::GlassLayout`]: a pane the simulation of the
//! scene's rain and dust wet), which the reader takes as they are; the page writes them only for an
//! engine with [`crate::FEATURE_GLASS_LAYOUT`], and with the coverage fields at 0, so an engine of S3
//! draws a clean pane.
//!
//! **Wet parts** (S3c). A `WETP` section is what the simulation of the scene's rain, dust and snow
//! left on instance `instance` ([`crate::weather`]): a grid of samples on each triangle of its mesh
//! (`triangles` must be the mesh's, each `resolution` 1 to 255, `samples` their sum of
//! `(R + 1)(R + 2)/2`), each wet, dusty and snowy (bytes: 0..1 and 0.02 mm steps), shaded over the
//! instance's material, and its drops, which the reader meshes as caps of water at `cap_angle_deg`
//! in one more mesh, instance and material after the file's own ([`crate::scene::Caps`]; a drop
//! counts in the part and material passes as that instance). An instance named twice or that is not
//! there, other triangles than its mesh's or more than [`crate::weather::MAX_WET_DROPS`] drops make
//! the file invalid. A file without `WETP` is the scene as before S3c; an engine of before skips the
//! section (the page writes it only for an engine with [`crate::FEATURE_WET_PARTS`]). An update
//! without `MESH` sections keeps the file's meshes and meshes the caps again.
//!
//! **Section view** (Q1). `SECT` is the plane `normal · p = distance` (millimetres, world
//! coordinates, Z up) of a section: everything on the side the normal points to is removed, from
//! the camera, the reflections, the refractions, the shadows and the photons alike, and with
//! `flags` bit 0 the cut is capped where it goes through a closed solid, with the material of
//! that solid ([`crate::geometry::SectionPlane`], the rules in [`crate::geometry`]). The normal
//! may not be zero (it is normalised, unless it is already unit to rounding), unknown flag bits are
//! ignored. A file without `SECT` is the whole model, byte for byte as before Q1; the writer adds
//! the section only when the scene has one. An update replaces it (a file without `SECT` has none).
//! An instance with `INST.flags` bit 1 (`2`, [`crate::geometry::INSTANCE_NO_SECTION`]) is the
//! studio around the model (a set's backdrop, floor and cards, which the page marks only while a
//! section cuts): the plane neither removes nor caps it.
//!
//! **Hidden to the camera** (K3). An instance with `INST.flags` bit 2 (`4`,
//! [`crate::geometry::INSTANCE_NO_CAMERA`]) is not seen by camera rays, nor by the rays that continue
//! them straight through cut-outs and thin walls, nor in the exact passes; every other ray sees it:
//! it reflects, refracts, casts its shadows, stops photons and sends its light (the ceiling of a
//! plan view: out of the picture, and the room still lit by it). A cap of the section view on such
//! an instance is hidden with it. Unknown bits are kept and ignored, so an engine of before K3
//! shows the instance.
//!
//! **Updates** (E4). [`Scene::update_from_rsb`] reads a file into an already loaded scene: a file
//! without `MESH` sections keeps the loaded meshes and their BVHs (its `INST` sections, or the
//! implicit instances, refer to them), so a host that changes the camera, the image size, the
//! instances, the materials or the lights sends everything but the geometry. In the same way a
//! file without `BMAP` sections keeps the loaded bitmaps (E5), which can be large. The particles of
//! an effect whose `FXAM` is unchanged are kept as well (S4a); only their BVH is built again when
//! the camera or the image size changed. The texture images travel with the meshes (M2b): a file
//! without `MESH` and `IMGS` keeps the loaded ones and their mipmaps; one with `MESH` and without
//! `IMGS` has none.
//!
//! # Meaning of the values (fixed in E3)
//!
//! Units: millimetres for positions and sizes, degrees for angles. Radiance is in
//! W / (sr m^2) and is what the film stores (exposure 0 shows radiance 1 as white before the tone
//! curve); for photometric quantities a scene millimetre is 1e-3 m.
//!
//! * `CAMR.ortho_flag` non-zero: orthographic camera `ortho_width` wide (no depth of field);
//!   otherwise a thin lens of `focal_mm` on a sensor `sensor_mm` wide along the longer image
//!   side, aperture `focal_mm / fstop` (`fstop` 0: pinhole), focused at `focus_dist`. Box pixel
//!   filter. **K3** appends the projection: **0** that camera (also what a file without the
//!   fields means, and any unknown value), **1** an equirectangular panorama (the longitude
//!   `(u − ½)·fov_x_deg` from the view axis towards the right across the width, the latitude
//!   `(½ − v)·fov_y_deg` towards `up` across the height; 360 × 180 is the whole sphere, more wraps
//!   around and over the poles), **2** an equidistant fisheye (the angle from the axis is
//!   `fov_x_deg` across the width per unit of distance from the centre, the same per pixel in both
//!   directions; beyond 180° a sample sees nothing and weighs black); a panoramic camera is a pinhole at
//!   `position` and reads neither `ortho_flag`, the focal length, the sensor, the aperture nor
//!   `LENS`. Then `exterior` (≥ 0): the factor of the environment a camera ray sees when it escapes,
//!   also through cut-outs and thin walls (the background, when it is the environment): 1 changes
//!   nothing. The fields of view must be positive and at most 3600. The writer adds the four only
//!   when one is not its default, so a file of before K3 keeps its bytes.
//! * `MATL.kind`: **0 principled** (Lambert diffuse of `base_color * (1 - metallic) *
//!   (1 - transmission)`; GGX specular with height-correlated Smith masking, roughness² as the GGX
//!   width, Schlick Fresnel with `F0 = ((ior - 1) / (ior + 1))²` for the dielectric and
//!   `base_color` for the metal, blended by `metallic`; the `transmission` share of the
//!   dielectric is clear: GGX reflection and refraction with the exact dielectric Fresnel of
//!   `ior`, tinted by `base_color` (see [`crate::bsdf`]); `coat` adds a second GGX lobe of
//!   `coat_roughness`, ior 1.5, on top; `anisotropy` stretches the GGX lobes along a tangent
//!   around the instance's local Z axis), **1 glass** (kind 0 without metal), **2 emissive**
//!   (radiance `emission * emission_power`, no reflection). Unknown kinds render as 0.
//!   `MATL.flags` bit 0 (`1`): an emissive material is also sampled as an area light by
//!   next-event estimation; bit 1 (`2`) **thin wall**: the clear part has no inside, light goes
//!   straight through it (no refraction, the colour once) and so do shadow rays. `opacity` below
//!   one makes the surface a stochastic cut-out (emitters ignore it); `absorption_mm` above zero
//!   makes `base_color` the colour white light keeps after that many millimetres inside a solid
//!   (Beer–Lambert) instead of a surface tint. `bevel_mm` (E6) above zero rounds the shading
//!   normal within that many millimetres of the mesh's sharp edges ([`crate::bevel`]); a file
//!   without it (72 B) has sharp edges. E9: `scatter_mm` above zero fills a clear solid with a
//!   scattering medium of that mean free path, single-scattering albedo `scatter_color` and
//!   Henyey–Greenstein anisotropy `scatter_g` (see [`crate::integrator::medium`]); `abbe` above
//!   zero makes the index of a clear solid without a medium depend on the wavelength (Cauchy's law
//!   through `ior` at the d line with that Abbe number, see [`crate::integrator::dispersion`]). A
//!   file written before E9 (72 or 76 B) reads them as 0, white, 0, 0: no medium and no
//!   dispersion.
//! * `LGHT.kind`: **0 rect** (`size_x` × `size_y`, its local Y axis along `up`), **1 disk**
//!   (diameter `size_x`), **2 sun** (a disc of angular diameter `angle_deg`, 0 for a delta
//!   direction), **3 point** and **4 spot** (L4), **5 IES** (L5, see below). Rect
//!   and disk emit from the face `direction` points to, `power` watts of flux without falloff
//!   (radiance `color * power / (π · area in m²)`), with a `cos^n` falloff from the normal whose
//!   intensity halves at `spread_deg / 2` (180: none; on-axis radiance does not change with
//!   spread, like a grid on a softbox). The sun's `power` is the irradiance (W/m²) it gives a
//!   surface facing it; light travels along `direction`. Lights are transparent: they never
//!   occlude. `LGHT.flags`: bit 0 (`1`) **glossy**, the light is seen by BSDF-sampled rays and
//!   lights every lobe (multiple importance sampling with next-event estimation); without it,
//!   it lights only the diffuse lobe, by next-event estimation alone, and is invisible in
//!   reflections. Bit 1 (`2`) **camera**: visible to camera rays.
//!   **IES** (kind 5, L5): the point light of `power` watts and diameter `size_x` (0: a point)
//!   whose intensity follows the photometric profile of the `IESP` section number `profile` (the
//!   `u32` after `flags`, by position among the `IESP` sections; none, or one past them, makes the
//!   file invalid) in each direction: `direction` is the profile's axis (vertical angle 0),
//!   `up` the direction of its horizontal angle 0, and the angle grows counter-clockwise
//!   looking along the axis from behind the light, from `up` towards its left (`crate::ies`). The profile gives the
//!   shape and `power` the level: the light is as bright in the profile's brightest direction as
//!   the point light of `power` watts, so a profile with 500 lumens and one with 5000 look the
//!   same. `spread_deg` and `angle_deg` are not read. A file whose profile cannot be read (a
//!   truncated table, a negative candela, a TILT table, photometric type A or B...) is invalid.
//! * `ENVR.kind`: **0 studio dome** (radiance ramps linearly with the z of the direction from
//!   `floor` at z = -1 through `horizon` at 0 to `zenith` at +1), **1 flat** (`horizon`
//!   everywhere), **2 sky** (daylight for `sky_turbidity` and the sun at `sun_azimuth_deg`
//!   from +X towards +Y and `sun_elevation_deg`, scaled to give a horizontal surface the
//!   irradiance of the dome with these values; the ground below the horizon is `floor`;
//!   `sky_model` **0** the physical sky, fitted to our own atmosphere simulation (also what a
//!   file without the field means, and any unknown value), **1** the classic Preetham sky; see
//!   [`crate::sky`]), **3 HDRI** (the equirectangular bitmap `hdri_map`, in the
//!   convention of [`crate::environment`]; the dome without it). Everything is scaled by
//!   `strength`; `rotation_deg` turns the HDRI about Z (counter-clockwise from above; no effect on
//!   the other kinds, the sky follows its sun). `background_mode`: **0** the environment is
//!   visible, **1** camera rays that escape see `background_color`, **2** transparent (they see
//!   black and the film's alpha is 0 there), **3** the background image `backplate_map`, seen by
//!   camera rays only, `backplate_fit` **0** cover the frame (cropped), **1** fit inside it (the
//!   rest is `background_color`), **2** stretched, the frame being `backplate_rect` of the image
//!   (a viewport renders more than the output frame); without the bitmap, mode 3 is mode 1. The
//!   environment lights the scene in every mode.
//! * `FLOR.mode`: **0** no floor, **1** an infinite Lambertian plane at height `z` of albedo
//!   `color`, **2** shadow catcher: the plane is invisible to everything except camera rays,
//!   where it shows the background darkened by the fraction of light the scene blocks (with a
//!   transparent background: black with that fraction as alpha).
//! * `PATN` (E6): the procedural pattern of the material `material` (its position among the
//!   `MATL` sections; at most one per material, the first counts), which replaces its base colour
//!   point by point, scales its roughness and tilts the shading normal by its relief
//!   ([`crate::pattern`]). `kind` **1 wood**: `color_a` the spring wood (light), `color_b` the
//!   summer wood (dark), `scale_mm` the ring spacing (bamboo: the strip width), `params` ring
//!   variation, ring noise, axial noise, colour noise, contrast (0: the colours as given), pore
//!   width in mm (0: none), pore depth, pore band (0 diffuse- to 1 ring-porous), fibre, the
//!   anisotropy of the roughness along the grain, then the knots (figure 0 only): count (0 to
//!   12), diameter in mm, variation of the diameter (± fraction) and darkness, then two unused
//!   (0); `variant` the figure (0 rings, 1 strips, 2 speckle, 3 streaked); `seed` the
//!   material's seed (where the knots are). `kind` **2 cloth**: `color_a` the warp, `color_b`
//!   the weft, `scale_mm` the distance between threads (knit: between stitches; felt: the size
//!   of its fibres), `params` the relief (0 to 1) and the yarn's twist (0 smooth filaments to 1),
//!   the rest unused (0); `variant` the weave (0
//!   plain, 1 twill 2/2, 2 satin, 3 canvas, 4 knit, 5 felt, 6 twill 3/1). Unknown kinds draw
//!   nothing. The writer emits the `PATN` sections right after the `MATL` ones.
//! * `RNDR.tonemap`: **0** linear (no curve, clipped), **1** ACES (Narkowicz fit), **2** filmic
//!   (log2 shaper and S-curve, Blender-like), **3** AgX, **4** standard (sRGB, clipped); unknown
//!   values mean ACES. `exposure_ev` multiplies by `2^ev` before the curve. `max_depth` is the
//!   most surface interactions per path (0: 8); `clamp_indirect` caps each channel of every
//!   indirect contribution (0: off). `max_seconds` is honoured by the host between sample
//!   passes. `passes` (X2) is the mask of the exact passes the host writes next to the image:
//!   bit `i` is [`crate::passes::PASS_KEYS`]`[i]` (albedo, normal, depth, partId, materialId,
//!   coc, and, N2, alpha); 0, or a file written before X2, asks for none, and unknown bits are
//!   kept and ignored.
//!   Asking for passes never changes a pixel of the image. `denoise` (E5b-1) tells the host what
//!   to hand out: bit 0 the denoised image, bit 1 also the one without denoise; the renderer
//!   ignores it. `caustic_photons` (E5b-1) is the number of photons traced per sample index for
//!   the caustics (0: none, at most 4 194 304; see [`crate::caustics`]) and `caustic_radius`
//!   their first gather radius in pixels at the focus distance (0: 3). `denoise_strength` (U11b,
//!   `0..=1`, default 1) is how much of the denoised image the host hands out (the rest is the
//!   image without denoise); the renderer ignores it too. `pixel_filter` (E11) is where the
//!   camera samples go ([`crate::pixel_filter`]: 0 the box of one pixel, 1 the centre, 2 a tent,
//!   3 Blackman–Harris; unknown values mean the box) and `edge_supersample` the samples an edge
//!   pixel takes per sample index (0 and 1: one; at most 16); a file of before renders as it did.
//!   `adaptive` (E10) bit 0 asks the host for adaptive sampling ([`crate::adaptive`]; unknown bits
//!   are kept and ignored) and `noise_threshold` (`0..=1`; 0 none) is the relative error of the
//!   mean under which a block needs no more samples; the writer adds the two only when one is
//!   set, so a scene without them is the 64-byte section of E11.
//! * `LENS` (O1, optional, written right after `CAMR`): the optics of the camera beyond the plain
//!   thin lens, see [`crate::optics`]. `blades` 0 is a round iris, 3 to 18 an iris of that many
//!   blades of `roundness` (0 straight, 1 the inscribed circle) turned by `rotation_deg`;
//!   `profile` **0** uniform, **1** bright centre `1 − k ρ²`, **2** bright ring
//!   `(1 − k) + k ρ²`, **3** apodized (a Gaussian of `ρ` with `σ = k`), `k` = `profile_param`
//!   (unknown profiles are uniform); `obstruction` the central obstruction (0 to 0.95 of the
//!   aperture); `cats_eye` (0 to 1) the cat's eye clip; `squeeze` (1 to 4) the anamorphic squeeze
//!   of the pupil; `shift_*_mm` the lens shift and `tilt_deg` (−45 to 45) about the axis at
//!   `tilt_axis_deg` the tilt (Scheimpflug; since O4 also of a traced lens, which a lens with
//!   cylinders refuses); `ca_amount` and `swirl` (0 to 1) the artistic
//!   chromatic aberration and swirl; `field_mm` the image height of the frame's corner (0: half
//!   the image's diagonal); `mask_kind` **0** none (size 0), **1** an aperture mask that replaces
//!   the iris, **2** a transmission texture multiplied with it, `mask_width × mask_height` 8-bit
//!   pixels (at most 1024 per side, 255 open) covering `[−1, 1]²` of the pupil, rows top to
//!   bottom, the unit circle inscribed. Values out of range make the file invalid. An orthographic
//!   camera ignores the section, and a file without it renders exactly as before O1.
//!   **O3a** appends the stack of three effect filters (see [`crate::optics::filters`]): `kind`
//!   **0** none, **1** white diffusion, **2** black diffusion, **3** gold diffusion, **4**
//!   glimmer, **5** soft, **6** net, **7** star, **8** streak; `grade` 0 (off) to 2; `tint` the
//!   tint of the scattered light (gold, net and streak; all zero: the kind's own); `angle_deg` the
//!   angle of a star's or a streak's first line, or of a net's axes; `points` a star's 4, 6 or 8
//!   (0: 6). A section without them, or with every slot zero, has no filters; the writer adds
//!   them only when there are any (or when a prescription follows).
//!   **O2** appends the traced lens (see [`crate::optics::traced`]): `surface_count` surfaces
//!   (object side first) of `kind` **0** sphere, **1** plane, **2** even asphere (`conic`,
//!   `a4`..`a10`), **3** cylinder with its axis along x, **4** along y, **5** mirror; `radius` (0 a
//!   plane), `thickness` to the next surface (negative while the light travels back after a
//!   mirror), the medium after the surface as `nd` (1 air) and `vd`, `semi_aperture` (0: derived)
//!   and `coating` (**0** not air–glass, **1** uncoated, **2** single layer, **3** multi-layer);
//!   `stop` is the index of the aperture stop, `focus_mode` **0** unit, **1** internal, **2**
//!   floating with the `moving` gaps between their `base` and `near` values (floating between the
//!   two magnifications), `f_number_min` the fastest stop (0: none given), and the artistic
//!   overrides (0: off). The engine scales the lens to `CAMR.focal_mm` and focuses it at
//!   `CAMR.focus_dist`; a file without the fields, or with 0 surfaces, is the O1 thin lens.
//!   **F1** may append `f32 frame_sensor_mm` after the prescription: the output frame's sensor
//!   along its longer side when `CAMR.sensor_mm` covers more than the frame (a viewport's image);
//!   the traced lens derives what belongs to the frame's corner from it (0 or absent: from
//!   `CAMR.sensor_mm`), so a viewport and the render see the same lens.

use super::{
    particle_sets, AmbientParams, Bitmap, Camera, EnvKind, Environment, Floor, FloorMode, Geometry,
    Instance, Lens, LensParams, Light, LightKind, Material, MaterialTextures, Mesh, PixelFootprint,
    Projection, RenderSettings, Scene, SectionPlane, SkyModel, TextureImage, Transform, NO_BITMAP,
};
use crate::color::Rgb;
use crate::ies::IesProfile;
use crate::math::Vec3;
use crate::optics::filters::FilterParams;
use crate::optics::glass::{FrontGlass, GlassLayout, GlassParams};
use crate::optics::traced::{MovingGap, Prescription, SurfaceSpec};
use std::fmt;
use std::sync::Arc;

/// The four magic bytes at the start of every RSB file.
pub const MAGIC: [u8; 4] = *b"RSB1";

/// Camera section tag.
pub const TAG_CAMR: [u8; 4] = *b"CAMR";
/// Mesh section tag.
pub const TAG_MESH: [u8; 4] = *b"MESH";
/// Material section tag.
pub const TAG_MATL: [u8; 4] = *b"MATL";
/// Light section tag.
pub const TAG_LGHT: [u8; 4] = *b"LGHT";
/// Environment section tag.
pub const TAG_ENVR: [u8; 4] = *b"ENVR";
/// Render settings section tag.
pub const TAG_RNDR: [u8; 4] = *b"RNDR";
/// Instance section tag.
pub const TAG_INST: [u8; 4] = *b"INST";
/// Floor section tag.
pub const TAG_FLOR: [u8; 4] = *b"FLOR";
/// Bitmap section tag.
pub const TAG_BMAP: [u8; 4] = *b"BMAP";
/// Pattern section tag (E6).
pub const TAG_PATN: [u8; 4] = *b"PATN";
/// Lens section tag (O1).
pub const TAG_LENS: [u8; 4] = *b"LENS";
/// Ambient effect section tag (S4a).
pub const TAG_FXAM: [u8; 4] = *b"FXAM";
/// Section tag of the texture images (M2b).
pub const TAG_IMGS: [u8; 4] = *b"IMGS";
/// Section tag of a material's program (M3b).
pub const TAG_PROG: [u8; 4] = *b"PROG";
/// Section tag of the section view's plane (Q1).
pub const TAG_SECT: [u8; 4] = *b"SECT";
/// Tag of the front glass section (S3, at most one).
pub const TAG_GLAS: [u8; 4] = *b"GLAS";
/// S3c: the rain, dust and snow on an instance ([`crate::weather`]).
pub const TAG_WETP: [u8; 4] = *b"WETP";

/// Widest field of view of a panoramic camera, degrees (`CAMR.fov_x_deg`, `fov_y_deg`; K3).
pub const MAX_FOV_DEG: f32 = 3600.0;

/// `SECT.flags` bit 0: the cut solids are capped.
pub const SECTION_CAP: u32 = 1;

/// Section tag of an IES photometric profile (L5).
pub const TAG_IESP: [u8; 4] = *b"IESP";

/// Why an RSB file could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RsbError {
    /// The file does not start with `RSB1`.
    BadMagic,
    /// The file ends in the middle of the named structure.
    Truncated {
        /// What was being read.
        what: &'static str,
    },
    /// A section payload is shorter than its tag requires.
    SectionTooShort {
        /// Tag of the offending section.
        tag: [u8; 4],
    },
    /// A section that may appear only once appears again.
    DuplicateSection {
        /// Tag of the repeated section.
        tag: [u8; 4],
    },
    /// A section holds a value that is not allowed.
    Invalid {
        /// Tag of the offending section.
        tag: [u8; 4],
        /// What is wrong.
        reason: &'static str,
    },
}

/// Formats a tag as text, replacing non printable bytes.
fn tag_text(tag: &[u8; 4]) -> String {
    tag.iter()
        .map(|&b| if b.is_ascii_graphic() { b as char } else { '?' })
        .collect()
}

impl fmt::Display for RsbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RsbError::BadMagic => write!(f, "not an RSB file (missing RSB1 magic)"),
            RsbError::Truncated { what } => write!(f, "RSB file is truncated in {what}"),
            RsbError::SectionTooShort { tag } => {
                write!(
                    f,
                    "RSB section {} is shorter than its layout requires",
                    tag_text(tag)
                )
            }
            RsbError::DuplicateSection { tag } => {
                write!(f, "RSB section {} appears more than once", tag_text(tag))
            }
            RsbError::Invalid { tag, reason } => {
                write!(f, "RSB section {} is invalid: {reason}", tag_text(tag))
            }
        }
    }
}

impl std::error::Error for RsbError {}

/// Cursor over one section payload.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    tag: [u8; 4],
}

impl<'a> Reader<'a> {
    fn new(tag: [u8; 4], data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0, tag }
    }

    fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn invalid(&self, reason: &'static str) -> RsbError {
        RsbError::Invalid {
            tag: self.tag,
            reason,
        }
    }

    fn word(&mut self) -> Result<[u8; 4], RsbError> {
        let bytes = self
            .data
            .get(self.pos..self.pos + 4)
            .ok_or(RsbError::SectionTooShort { tag: self.tag })?;
        self.pos += 4;
        Ok([bytes[0], bytes[1], bytes[2], bytes[3]])
    }

    fn u32(&mut self) -> Result<u32, RsbError> {
        Ok(u32::from_le_bytes(self.word()?))
    }

    fn f32(&mut self) -> Result<f32, RsbError> {
        let v = f32::from_le_bytes(self.word()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(self.invalid("non-finite number"))
        }
    }

    fn vec3(&mut self) -> Result<Vec3, RsbError> {
        Ok(Vec3::new(self.f32()?, self.f32()?, self.f32()?))
    }

    fn rgb(&mut self) -> Result<Rgb, RsbError> {
        Ok(Rgb::new(self.f32()?, self.f32()?, self.f32()?))
    }

    /// An optional trailing `u32`: `default` when the payload ends here.
    fn opt_u32(&mut self, default: u32) -> Result<u32, RsbError> {
        if self.remaining() >= 4 {
            self.u32()
        } else {
            Ok(default)
        }
    }

    /// An optional trailing `f32`: `default` when the payload ends here.
    fn opt_f32(&mut self, default: f32) -> Result<f32, RsbError> {
        if self.remaining() >= 4 {
            self.f32()
        } else {
            Ok(default)
        }
    }
}

fn parse_camera(r: &mut Reader) -> Result<Camera, RsbError> {
    let camera = Camera {
        position: r.vec3()?,
        target: r.vec3()?,
        up: r.vec3()?,
        focal_mm: r.f32()?,
        sensor_mm: r.f32()?,
        fstop: r.f32()?,
        focus_dist: r.f32()?,
        ortho: r.u32()? != 0,
        ortho_width: r.f32()?,
        lens: None,
        // K3: the projection and the exterior factor, when the section goes on.
        projection: Projection::from_u32(r.opt_u32(0)?),
        fov_x_deg: r.opt_f32(360.0)?,
        fov_y_deg: r.opt_f32(180.0)?,
        exterior: r.opt_f32(1.0)?,
    };
    if camera.focal_mm <= 0.0 || camera.sensor_mm <= 0.0 {
        return Err(r.invalid("focal_mm and sensor_mm must be positive"));
    }
    if camera.fstop < 0.0 || camera.focus_dist < 0.0 || camera.ortho_width < 0.0 {
        return Err(r.invalid("fstop, focus_dist and ortho_width must not be negative"));
    }
    let field = |v: f32| v > 0.0 && v <= MAX_FOV_DEG;
    if !field(camera.fov_x_deg) || !field(camera.fov_y_deg) {
        return Err(r.invalid("fov_x_deg and fov_y_deg must be positive and at most 3600"));
    }
    if camera.exterior < 0.0 {
        return Err(r.invalid("exterior must not be negative"));
    }
    Ok(camera)
}

fn parse_lens(r: &mut Reader) -> Result<Lens, RsbError> {
    let mut p = LensParams {
        blades: r.u32()?,
        roundness: r.f32()?,
        rotation_deg: r.f32()?,
        profile: r.u32()?,
        profile_param: r.f32()?,
        obstruction: r.f32()?,
        cats_eye: r.f32()?,
        squeeze: r.f32()?,
        shift_x_mm: r.f32()?,
        shift_y_mm: r.f32()?,
        tilt_deg: r.f32()?,
        tilt_axis_deg: r.f32()?,
        ca_amount: r.f32()?,
        swirl: r.f32()?,
        field_mm: r.f32()?,
        mask_kind: r.u32()?,
        mask_width: r.u32()?,
        mask_height: r.u32()?,
        mask: Vec::new(),
        filters: [FilterParams::default(); 3],
        prescription: None,
        frame_sensor_mm: 0.0,
    };
    let len = u64::from(p.mask_width) * u64::from(p.mask_height);
    let padded = len.div_ceil(4) * 4;
    if padded > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    p.mask = r.data[r.pos..r.pos + len as usize].to_vec();
    r.pos += padded as usize;
    // O3a: the stack of effect filters, when the section goes on (an O1 file has none).
    if r.remaining() > 0 {
        for f in &mut p.filters {
            *f = FilterParams {
                kind: r.u32()?,
                grade: r.f32()?,
                tint: [r.f32()?, r.f32()?, r.f32()?],
                angle_deg: r.f32()?,
                points: r.u32()?,
            };
        }
    }
    let count = r.opt_u32(0)?;
    if count > 0 {
        if count > 64 {
            return Err(r.invalid("a prescription has at most 64 surfaces"));
        }
        let stop = r.u32()?;
        let focus_mode = r.u32()?;
        let f_number_min = r.f32()?;
        let magnification = (r.f32()?, r.f32()?);
        let (distortion, vignetting, spherical, breathing) =
            (r.f32()?, r.f32()?, r.f32()?, r.f32()?);
        let moving_count = r.u32()?;
        if moving_count > 8 {
            return Err(r.invalid("at most 8 moving gaps"));
        }
        let mut moving = Vec::with_capacity(moving_count as usize);
        for _ in 0..moving_count {
            moving.push(MovingGap {
                surface: r.u32()?,
                base: r.f32()?,
                near: r.f32()?,
            });
        }
        let mut surfaces = Vec::with_capacity(count as usize);
        for _ in 0..count {
            surfaces.push(SurfaceSpec {
                kind: r.u32()?,
                radius: r.f32()?,
                thickness: r.f32()?,
                nd: r.f32()?,
                vd: r.f32()?,
                semi_aperture: r.f32()?,
                coating: r.u32()?,
                conic: r.f32()?,
                aspheric: [r.f32()?, r.f32()?, r.f32()?, r.f32()?],
            });
        }
        if f_number_min.is_nan()
            || f_number_min < 0.0
            || !(-1.0..=1.0).contains(&distortion)
            || !(0.0..=1.0).contains(&vignetting)
            || !(-1.0..=1.0).contains(&spherical)
            || !(-1.0..=1.0).contains(&breathing)
        {
            return Err(r.invalid("an override of the traced lens is out of range"));
        }
        p.prescription = Some(Prescription {
            stop,
            focus_mode,
            f_number_min,
            magnification,
            distortion,
            vignetting,
            spherical,
            breathing,
            moving,
            surfaces,
        });
        // F1: the frame's sensor after the prescription (absent: the camera's own).
        p.frame_sensor_mm = r.opt_f32(0.0)?;
    }
    Lens::new(p).map_err(|reason| r.invalid(reason))
}

/// A `MESH` section, and whether it carried the UV sets word (M2b).
fn parse_mesh(r: &mut Reader) -> Result<(Mesh, bool), RsbError> {
    let vertex_count = r.u32()?;
    let index_count = r.u32()?;
    // Check the declared sizes against the payload before allocating anything, so a hostile
    // header cannot request gigabytes.
    let words = u64::from(vertex_count) * 6 + u64::from(index_count) + 1;
    if words * 4 > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    if index_count % 3 != 0 {
        return Err(r.invalid("index_count is not a multiple of 3"));
    }
    let n = vertex_count as usize;
    let mut positions = Vec::with_capacity(n);
    for _ in 0..n {
        positions.push(r.vec3()?);
    }
    let mut normals = Vec::with_capacity(n);
    for _ in 0..n {
        normals.push(r.vec3()?);
    }
    let mut indices = Vec::with_capacity(index_count as usize);
    for _ in 0..index_count {
        let index = r.u32()?;
        if index >= vertex_count {
            return Err(r.invalid("vertex index out of range"));
        }
        indices.push(index);
    }
    let material_id = r.u32()?;
    let mesh = Mesh::new(&positions, &normals, &indices, material_id)
        .map_err(|e| r.invalid(e.reason()))?;
    // M2b: the UV sets after the material, when the file carries textures.
    if r.remaining() < 4 {
        return Ok((mesh, false));
    }
    let sets = r.u32()? as usize;
    if sets > crate::geometry::MAX_UV_SETS {
        return Err(r.invalid("at most 2 UV sets"));
    }
    if (sets * n * 8) as u64 > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    let mut uvs = Vec::with_capacity(sets);
    for _ in 0..sets {
        let mut set = Vec::with_capacity(n);
        for _ in 0..n {
            set.push([r.f32()?, r.f32()?]);
        }
        uvs.push(set);
    }
    let mesh = mesh.with_uvs(uvs).map_err(|e| r.invalid(e.reason()))?;
    Ok((mesh, true))
}

fn parse_instance(r: &mut Reader) -> Result<Instance, RsbError> {
    let mesh = r.u32()?;
    let mut rows = [[0.0f32; 4]; 3];
    for row in &mut rows {
        for value in row.iter_mut() {
            *value = r.f32()?;
        }
    }
    Ok(Instance {
        mesh,
        transform: Transform::from_rows(rows),
        material_id: r.u32()?,
        flags: r.u32()?,
    })
}

/// A `MATL` section and its texture block (M2b), if it has one this engine reads.
fn parse_material(r: &mut Reader) -> Result<(Material, Option<MaterialTextures>), RsbError> {
    let m = Material {
        kind: r.u32()?,
        base_color: r.rgb()?,
        metallic: r.f32()?,
        roughness: r.f32()?,
        ior: r.f32()?,
        transmission: r.f32()?,
        coat: r.f32()?,
        coat_roughness: r.f32()?,
        emission: r.rgb()?,
        emission_power: r.f32()?,
        flags: r.opt_u32(0)?,
        opacity: r.opt_f32(1.0)?,
        anisotropy: r.opt_f32(0.0)?,
        absorption_mm: r.opt_f32(0.0)?,
        bevel_mm: r.opt_f32(0.0)?,
        scatter_mm: r.opt_f32(0.0)?,
        scatter_color: Rgb::new(r.opt_f32(1.0)?, r.opt_f32(1.0)?, r.opt_f32(1.0)?),
        scatter_g: r.opt_f32(0.0)?,
        abbe: r.opt_f32(0.0)?,
    };
    // M2b: the texture block from byte 100; a block of another version is a newer file's.
    if r.remaining() < 4 || r.pos != crate::texture::TEXTURE_BLOCK_OFFSET {
        return Ok((m, None));
    }
    if r.u32()? != crate::texture::TEXTURE_BLOCK_VERSION {
        return Ok((m, None));
    }
    Ok((m, Some(parse_texture_block(r)?)))
}

/// The texture block of a `MATL` after its version word (M2b).
fn parse_texture_block(r: &mut Reader) -> Result<MaterialTextures, RsbError> {
    use crate::texture::{Label, TextureSlot};
    let image = |v: u32| (v != u32::MAX).then_some(v);
    let mut t = MaterialTextures::default();
    for slot in &mut t.slots {
        *slot = TextureSlot {
            image: image(r.u32()?),
            projection: r.u32()?,
            axis: r.u32()?,
            uv_set: r.u32()?,
            size_mm: r.f32()?,
            rotation_deg: r.f32()?,
            offset: [r.f32()?, r.f32()?],
            repeat: [r.f32()?, r.f32()?],
            wrap: r.u32()?,
            channel: r.u32()?,
            flags: r.u32()?,
            strength: r.f32()?,
            cutoff: r.f32()?,
        };
        if slot.projection > crate::texture::PROJECTION_SPHERICAL
            || slot.axis > crate::texture::AXIS_Z
            || slot.uv_set > 1
            || slot.wrap > crate::texture::WRAP_MIRROR
            || slot.channel > crate::texture::CHANNEL_LUMINANCE
        {
            return Err(r.invalid("unknown texture projection, axis, UV set, wrap or channel"));
        }
        if slot.size_mm.is_nan() || slot.size_mm <= 0.0 {
            return Err(r.invalid("texture size_mm must be positive"));
        }
    }
    t.emission_tint = r.rgb()?;
    let count = r.u32()? as usize;
    if count as u64 * 76 > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    for _ in 0..count {
        let label = Label {
            image: image(r.u32()?),
            origin: r.vec3()?,
            u: r.vec3()?,
            v: r.vec3()?,
            normal: r.vec3()?,
            width_mm: r.f32()?,
            height_mm: r.f32()?,
            depth_mm: r.f32()?,
            roughness: r.f32()?,
            coat: r.f32()?,
            relief: r.f32()?,
        };
        if !(label.width_mm > 0.0 && label.height_mm > 0.0) || label.depth_mm < 0.0 {
            return Err(r.invalid("a label needs a positive size and a reach of 0 or more"));
        }
        t.labels.push(label);
    }
    Ok(t)
}

/// The `IMGS` section (M2b): the texture images, their mipmaps computed here.
fn parse_images(r: &mut Reader) -> Result<Vec<Arc<TextureImage>>, RsbError> {
    let count = r.u32()? as usize;
    if count as u64 * 16 > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let width = r.u32()?;
        let height = r.u32()?;
        let channels = r.u32()?;
        let color_space = r.u32()?;
        let len = u64::from(width) * u64::from(height) * u64::from(channels);
        if len > r.remaining() as u64 {
            return Err(RsbError::SectionTooShort { tag: r.tag });
        }
        let len = len as usize;
        let data = r.data[r.pos..r.pos + len].to_vec();
        r.pos += len;
        let pad = (4 - len % 4) % 4;
        r.pos = (r.pos + pad).min(r.data.len());
        let image = TextureImage::new(width, height, channels, color_space, data)
            .map_err(|reason| r.invalid(reason))?;
        out.push(Arc::new(image));
    }
    Ok(out)
}

fn parse_pattern(r: &mut Reader) -> Result<crate::pattern::Pattern, RsbError> {
    let material = r.u32()?;
    let kind = r.u32()?;
    let color_a = r.rgb()?;
    let color_b = r.rgb()?;
    let scale_mm = r.f32()?;
    let mut params = [0.0f32; crate::pattern::PARAMS];
    for p in &mut params {
        *p = r.f32()?;
    }
    let pattern = crate::pattern::Pattern {
        material,
        kind,
        color_a,
        color_b,
        scale_mm,
        params,
        variant: r.u32()?,
        seed: r.u32()?,
    };
    if pattern.scale_mm < 0.0 {
        return Err(r.invalid("scale_mm must not be negative"));
    }
    Ok(pattern)
}

/// A light, and for an IES light the position of its profile among the `IESP` sections.
fn parse_light(r: &mut Reader) -> Result<(Light, Option<u32>), RsbError> {
    let kind = LightKind::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown light kind"))?;
    let light = Light {
        kind,
        position: r.vec3()?,
        direction: r.vec3()?,
        up: r.vec3()?,
        size_x: r.f32()?,
        size_y: r.f32()?,
        color: r.rgb()?,
        power: r.f32()?,
        spread_deg: r.f32()?,
        angle_deg: r.f32()?,
        flags: r.u32()?,
        ies: None,
    };
    let profile = if kind == LightKind::Ies {
        Some(r.opt_u32(NO_PROFILE)?)
    } else {
        None
    };
    Ok((light, profile))
}

/// `LGHT.profile` of an IES light that has none.
const NO_PROFILE: u32 = u32::MAX;

/// An `IESP` section: the length of the file, the file and its padding.
fn parse_profile(r: &mut Reader) -> Result<Arc<IesProfile>, RsbError> {
    let len = r.u32()? as usize;
    if len > r.remaining() {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    let file = &r.data[r.pos..r.pos + len];
    r.pos += len;
    IesProfile::parse(file)
        .map(Arc::new)
        .map_err(|e| r.invalid(e.reason()))
}

fn parse_environment(r: &mut Reader) -> Result<Environment, RsbError> {
    let kind = EnvKind::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown environment kind"))?;
    Ok(Environment {
        kind,
        floor: r.f32()?,
        horizon: r.f32()?,
        zenith: r.f32()?,
        strength: r.f32()?,
        rotation_deg: r.f32()?,
        background_color: r.rgb()?,
        background_mode: r.u32()?,
        hdri_map: r.opt_u32(NO_BITMAP)?,
        backplate_map: r.opt_u32(NO_BITMAP)?,
        backplate_fit: r.opt_u32(super::BACKPLATE_FILL)?,
        sky_turbidity: r.opt_f32(crate::sky::DEFAULT_TURBIDITY)?,
        sun_azimuth_deg: r.opt_f32(0.0)?,
        sun_elevation_deg: r.opt_f32(45.0)?,
        backplate_rect: [
            r.opt_f32(0.0)?,
            r.opt_f32(0.0)?,
            r.opt_f32(1.0)?,
            r.opt_f32(1.0)?,
        ],
        sky_model: SkyModel::from_u32(r.opt_u32(SkyModel::Physical.to_u32())?),
    })
}

fn parse_bitmap(r: &mut Reader) -> Result<Bitmap, RsbError> {
    let format = r.u32()?;
    let width = r.u32()?;
    let height = r.u32()?;
    let len = r.u32()? as usize;
    if len > r.remaining() {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    let data = r.data[r.pos..r.pos + len].to_vec();
    r.pos += len;
    Bitmap::decode(format, width, height, data).map_err(|e| r.invalid(e.reason()))
}

fn parse_section(r: &mut Reader) -> Result<SectionPlane, RsbError> {
    let flags = r.u32()?;
    let normal = r.vec3()?;
    let distance = r.f32()?;
    SectionPlane::new(normal, distance, flags & SECTION_CAP != 0)
        .ok_or_else(|| r.invalid("section normal is zero"))
}

fn parse_floor(r: &mut Reader) -> Result<Floor, RsbError> {
    let mode = FloorMode::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown floor mode"))?;
    Ok(Floor {
        mode,
        z: r.f32()?,
        color: r.rgb()?,
    })
}

fn parse_render(r: &mut Reader) -> Result<RenderSettings, RsbError> {
    let settings = RenderSettings {
        width: r.u32()?,
        height: r.u32()?,
        max_samples: r.u32()?,
        seed: r.u32()?,
        max_seconds: r.f32()?,
        exposure_ev: r.f32()?,
        tonemap: r.u32()?,
        max_depth: r.opt_u32(RenderSettings::DEFAULT_MAX_DEPTH)?,
        clamp_indirect: r.opt_f32(0.0)?,
        passes: r.opt_u32(0)?,
        denoise: r.opt_u32(0)?,
        caustic_photons: r.opt_u32(0)?,
        caustic_radius: r.opt_f32(0.0)?,
        denoise_strength: r.opt_f32(1.0)?,
        pixel_filter: r.opt_u32(0)?,
        edge_supersample: r.opt_u32(1)?,
        adaptive: r.opt_u32(0)?,
        noise_threshold: r.opt_f32(0.0)?,
    };
    if !(0.0..=crate::adaptive::MAX_NOISE_THRESHOLD).contains(&settings.noise_threshold) {
        return Err(r.invalid("noise_threshold must be between 0 and 1"));
    }
    if settings.edge_supersample > crate::pixel_filter::MAX_EDGE_SUPERSAMPLE {
        return Err(r.invalid("edge_supersample must be at most 16"));
    }
    if !(0.0..=1.0).contains(&settings.denoise_strength) {
        return Err(r.invalid("denoise_strength must be between 0 and 1"));
    }
    if settings.caustic_photons > RenderSettings::MAX_CAUSTIC_PHOTONS {
        return Err(r.invalid("caustic_photons must be at most 4194304"));
    }
    if settings.caustic_radius < 0.0 {
        return Err(r.invalid("caustic_radius must not be negative"));
    }
    let range = 1..=RenderSettings::MAX_DIMENSION;
    if !range.contains(&settings.width) || !range.contains(&settings.height) {
        return Err(r.invalid("width and height must be between 1 and 16384"));
    }
    if settings.max_seconds < 0.0 || settings.clamp_indirect < 0.0 {
        return Err(r.invalid("max_seconds and clamp_indirect must not be negative"));
    }
    Ok(settings)
}

/// Stores `value` in `slot`, failing if the section was already seen.
fn set_once<T>(slot: &mut Option<T>, tag: [u8; 4], value: T) -> Result<(), RsbError> {
    if slot.replace(value).is_some() {
        Err(RsbError::DuplicateSection { tag })
    } else {
        Ok(())
    }
}

/// The bytes of a traced lens at the end of `LENS` (O2): the surface count, the stop, the focus,
/// the overrides, the moving gaps and the surfaces, little-endian.
pub fn prescription_bytes(t: &Prescription) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + 12 * t.moving.len() + 48 * t.surfaces.len());
    let u32_ = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
    let f32_ = |out: &mut Vec<u8>, v: f32| out.extend_from_slice(&v.to_le_bytes());
    u32_(&mut out, t.surfaces.len() as u32);
    u32_(&mut out, t.stop);
    u32_(&mut out, t.focus_mode);
    for v in [
        t.f_number_min,
        t.magnification.0,
        t.magnification.1,
        t.distortion,
        t.vignetting,
        t.spherical,
        t.breathing,
    ] {
        f32_(&mut out, v);
    }
    u32_(&mut out, t.moving.len() as u32);
    for m in &t.moving {
        u32_(&mut out, m.surface);
        f32_(&mut out, m.base);
        f32_(&mut out, m.near);
    }
    for s in &t.surfaces {
        u32_(&mut out, s.kind);
        for v in [s.radius, s.thickness, s.nd, s.vd, s.semi_aperture] {
            f32_(&mut out, v);
        }
        u32_(&mut out, s.coating);
        f32_(&mut out, s.conic);
        for v in s.aspheric {
            f32_(&mut out, v);
        }
    }
    out
}

/// What an update may keep of the loaded scene.
struct Kept<'a> {
    geometry: &'a mut Geometry,
    bitmaps: &'a mut Vec<Bitmap>,
    /// The texture images (M2b), which travel with the meshes.
    images: &'a mut Vec<Arc<TextureImage>>,
    /// The loaded camera's lens: its traced preparation is reused when it still applies (O2).
    lens: Option<&'a Lens>,
    /// S3c: the kept geometry's caps of drops (its last mesh), which are not the file's.
    caps: Option<crate::scene::Caps>,
}

/// Parses an RSB file. With `kept`, a file without `MESH` sections uses the meshes of `kept`
/// instead, and one without `BMAP` sections its bitmaps (moved out of it only once nothing can
/// fail any more, so `kept` is untouched on error).
fn read_scene(bytes: &[u8], kept: Option<Kept>) -> Result<Scene, RsbError> {
    if bytes.len() < 4 || bytes[..4] != MAGIC {
        return Err(RsbError::BadMagic);
    }
    let header_len = bytes
        .get(4..8)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or(RsbError::Truncated { what: "header" })?;
    let mut pos = 8usize
        .checked_add(header_len as usize)
        .filter(|&p| p <= bytes.len())
        .ok_or(RsbError::Truncated { what: "header" })?;

    let mut camera = None;
    let mut lens = None;
    let mut environment = None;
    let mut floor = None;
    let mut render = None;
    let mut meshes = Vec::new();
    let mut instances = Vec::new();
    let mut bitmaps = Vec::new();
    let mut effects = Vec::new();
    let mut images: Option<Vec<Arc<TextureImage>>> = None;
    let mut programs: Vec<(u32, crate::program::Program)> = Vec::new();
    let mut section = None;
    let mut glass = None;
    let mut wet: Vec<crate::weather::PartWeather> = Vec::new();
    let mut profiles: Vec<Arc<IesProfile>> = Vec::new();
    // The profile each IES light names, by the light's position in `scene.lights`.
    let mut light_profiles: Vec<(usize, u32)> = Vec::new();
    let mut textured = false;
    let mut scene = Scene::default();

    while pos < bytes.len() {
        let head = bytes.get(pos..pos + 8).ok_or(RsbError::Truncated {
            what: "section header",
        })?;
        let tag = [head[0], head[1], head[2], head[3]];
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        let payload = (pos + 8)
            .checked_add(len)
            .and_then(|end| bytes.get(pos + 8..end))
            .ok_or(RsbError::Truncated {
                what: "section payload",
            })?;
        pos += 8 + len;

        let mut r = Reader::new(tag, payload);
        match tag {
            TAG_CAMR => set_once(&mut camera, tag, parse_camera(&mut r)?)?,
            TAG_LENS => set_once(&mut lens, tag, parse_lens(&mut r)?)?,
            TAG_ENVR => set_once(&mut environment, tag, parse_environment(&mut r)?)?,
            TAG_FLOR => set_once(&mut floor, tag, parse_floor(&mut r)?)?,
            TAG_RNDR => set_once(&mut render, tag, parse_render(&mut r)?)?,
            TAG_MESH => {
                let (mesh, uvs) = parse_mesh(&mut r)?;
                textured |= uvs;
                meshes.push(mesh);
            }
            TAG_INST => instances.push(parse_instance(&mut r)?),
            TAG_MATL => {
                let (material, textures) = parse_material(&mut r)?;
                textured |= textures.is_some();
                scene.materials.push(material);
                scene.textures.push(textures);
            }
            TAG_IMGS => {
                set_once(&mut images, tag, parse_images(&mut r)?)?;
                textured = true;
            }
            TAG_LGHT => {
                let (light, profile) = parse_light(&mut r)?;
                if let Some(p) = profile {
                    light_profiles.push((scene.lights.len(), p));
                }
                scene.lights.push(light);
            }
            TAG_IESP => profiles.push(parse_profile(&mut r)?),
            TAG_BMAP => bitmaps.push(parse_bitmap(&mut r)?),
            TAG_PATN => scene.patterns.push(parse_pattern(&mut r)?),
            TAG_PROG => {
                let material = r.u32()?;
                match crate::program::Program::decode(&payload[4..]) {
                    Ok(program) => programs.push((material, program)),
                    // A newer contract: the material keeps its plain values.
                    Err(crate::program::ProgramError::Version(_)) => {}
                    Err(crate::program::ProgramError::Invalid(reason)) => {
                        return Err(RsbError::Invalid { tag, reason })
                    }
                }
            }
            TAG_FXAM => effects.push(AmbientParams::decode(payload).map_err(|e| match e {
                rt_sim::FxamError::TooShort => RsbError::SectionTooShort { tag },
                rt_sim::FxamError::Invalid(reason) => RsbError::Invalid { tag, reason },
            })?),
            TAG_SECT => set_once(&mut section, tag, parse_section(&mut r)?)?,
            TAG_GLAS => {
                if payload.len() < crate::optics::glass::GLAS_BYTES {
                    return Err(RsbError::SectionTooShort { tag });
                }
                let params = GlassParams::decode(payload)
                    .map_err(|reason| RsbError::Invalid { tag, reason })?;
                // S3b: the drops and motes one by one, when the payload lists them.
                let layout = GlassLayout::decode(payload)
                    .map_err(|reason| RsbError::Invalid { tag, reason })?;
                set_once(&mut glass, tag, (params, layout))?;
            }
            TAG_WETP => {
                if payload.len() < crate::weather::WETP_HEADER {
                    return Err(RsbError::SectionTooShort { tag });
                }
                wet.push(
                    crate::weather::PartWeather::decode(payload)
                        .map_err(|reason| RsbError::Invalid { tag, reason })?,
                );
            }
            _ => {} // Unknown section: skipped for forward compatibility.
        }
    }

    // L5: each IES light, with the profile it names.
    for (light, profile) in light_profiles {
        let Some(found) = profiles.get(profile as usize) else {
            return Err(RsbError::Invalid {
                tag: TAG_LGHT,
                reason: "an IES light needs a profile that is an IESP section",
            });
        };
        scene.lights[light].ies = Some(Arc::clone(found));
    }
    // The meshes the instances refer to: the file's own, or the kept ones when it has none; the
    // same for the bitmaps.
    let (kept_geometry, kept_bitmaps, kept_lens, kept_images, kept_caps) = match kept {
        Some(k) => (
            Some(k.geometry),
            Some(k.bitmaps),
            k.lens,
            Some(k.images),
            k.caps,
        ),
        None => (None, None, None, None, None),
    };
    // S3c: the kept meshes the file may refer to (not the caps of drops).
    let file_meshes = |g: &Geometry| kept_caps.map_or(g.meshes().len(), |c| c.mesh as usize);
    let reuse_meshes = meshes.is_empty() && kept_geometry.is_some();
    // M2b: the images travel with the meshes: a file without either keeps the loaded ones.
    let reuse_images = if images.is_none() && reuse_meshes {
        kept_images
    } else {
        None
    };
    let image_count = match (&images, &reuse_images) {
        (Some(list), _) => list.len(),
        (None, Some(kept)) => kept.len(),
        (None, None) => 0,
    };
    if scene
        .textures
        .iter()
        .flatten()
        .any(|t| t.max_image().is_some_and(|i| i as usize >= image_count))
    {
        return Err(RsbError::Invalid {
            tag: TAG_MATL,
            reason: "texture image index does not refer to an IMGS image",
        });
    }
    // M3b: each material's program, against the images it will read.
    let image_list: &[Arc<TextureImage>] = match (&images, &reuse_images) {
        (Some(list), _) => list.as_slice(),
        (None, Some(kept)) => kept.as_slice(),
        (None, None) => &[],
    };
    let invalid_program = |reason| RsbError::Invalid {
        tag: TAG_PROG,
        reason,
    };
    for (material, p) in &programs {
        if *material as usize >= scene.materials.len() {
            return Err(invalid_program("material does not refer to a MATL section"));
        }
        if !p.is_material() {
            return Err(invalid_program(
                "a material program needs the fifteen outputs of the output node",
            ));
        }
        for entry in &p.images {
            let Some(k) = entry.image else { continue };
            let space = if entry.srgb {
                crate::texture::image::COLOR_SRGB
            } else {
                crate::texture::image::COLOR_LINEAR
            };
            if image_list
                .get(k as usize)
                .is_none_or(|im| im.color_space() != space)
            {
                return Err(invalid_program(
                    "program image index does not refer to an IMGS image of its colour space",
                ));
            }
        }
    }
    let reuse_bitmaps = if bitmaps.is_empty() {
        kept_bitmaps
    } else {
        None
    };
    let bitmap_count = reuse_bitmaps.as_ref().map_or(bitmaps.len(), |b| b.len());
    let environment = environment.unwrap_or_default();
    for map in [environment.hdri_map, environment.backplate_map] {
        if map != NO_BITMAP && map as usize >= bitmap_count {
            return Err(RsbError::Invalid {
                tag: TAG_ENVR,
                reason: "bitmap index does not refer to a BMAP section",
            });
        }
    }
    let available: &[Mesh] = match &kept_geometry {
        Some(geometry) if reuse_meshes => &geometry.meshes()[..file_meshes(geometry)],
        _ => &meshes,
    };
    let materials = scene.materials.len();
    if available
        .iter()
        .any(|m| m.material_id() as usize >= materials)
    {
        return Err(RsbError::Invalid {
            tag: TAG_MESH,
            reason: "material_id does not refer to a MATL section",
        });
    }
    if instances.is_empty() {
        instances = Geometry::implicit_instances(available);
    }
    let invalid_instance = |reason| RsbError::Invalid {
        tag: TAG_INST,
        reason,
    };
    if instances.iter().any(|i| i.mesh as usize >= available.len()) {
        return Err(invalid_instance("mesh_id does not refer to a MESH section"));
    }
    if instances
        .iter()
        .any(|i| i.material_id as usize >= materials)
    {
        return Err(invalid_instance(
            "material_id does not refer to a MATL section",
        ));
    }
    if instances.len() > crate::geometry::MAX_INSTANCES {
        return Err(invalid_instance("too many instances"));
    }
    if scene
        .patterns
        .iter()
        .any(|p| p.material as usize >= materials)
    {
        return Err(RsbError::Invalid {
            tag: TAG_PATN,
            reason: "material does not refer to a MATL section",
        });
    }
    if effects.iter().any(|e| e.material_id as usize >= materials) {
        return Err(RsbError::Invalid {
            tag: TAG_FXAM,
            reason: "material_id does not refer to a MATL section",
        });
    }
    if instances.len() + effects.len() > crate::geometry::MAX_INSTANCES {
        return Err(RsbError::Invalid {
            tag: TAG_FXAM,
            reason: "too many instances and effects",
        });
    }
    // S3c: the weather of the instances, and room for the instance of the drops' caps.
    crate::weather::check_parts(&wet, &instances, available).map_err(|reason| {
        RsbError::Invalid {
            tag: TAG_WETP,
            reason,
        }
    })?;
    if wet.iter().any(|w| !w.drops.is_empty())
        && instances.len() + effects.len() + 1 > crate::geometry::MAX_INSTANCES
    {
        return Err(RsbError::Invalid {
            tag: TAG_WETP,
            reason: "too many instances for the drops",
        });
    }
    let mut camera = camera.unwrap_or_default();
    camera.lens = lens;
    // O2: the traced lens is prepared for this camera, or keeps the preparation of the loaded
    // scene when only the camera's placement changed (before the kept data are taken: it can
    // fail).
    let key = camera.optics_key();
    if let (Some(new), Some(old)) = (camera.lens.as_mut(), kept_lens) {
        new.reuse(old, key);
    }
    camera.prepare_lens().map_err(|reason| RsbError::Invalid {
        tag: TAG_LENS,
        reason,
    })?;
    // Nothing below can fail: only now are the kept meshes, particles and bitmaps taken.
    let mut kept_sets = Vec::new();
    if let Some(geometry) = kept_geometry {
        kept_sets = geometry.take_particles();
        if reuse_meshes {
            let keep = file_meshes(geometry);
            meshes = std::mem::take(geometry).into_meshes();
            meshes.truncate(keep);
        }
    }
    if let Some(kept) = reuse_bitmaps {
        bitmaps = std::mem::take(kept);
    }
    let images = match (images, reuse_images) {
        (Some(list), _) => list,
        (None, Some(kept)) => std::mem::take(kept),
        (None, None) => Vec::new(),
    };
    let render = render.unwrap_or_default();
    let width = crate::geometry::BvhWidth::native();
    let footprint = PixelFootprint::of(&camera, render.width, render.height);
    let sets = particle_sets(&effects, kept_sets, footprint, width, &scene.materials);
    scene.geometry = Geometry::with_particles(meshes, instances, sets, width)
        .map_err(|_| invalid_instance("too many instances"))?;
    scene.bitmaps = bitmaps;
    scene.images = images;
    // A scene without texture blocks holds no list of them (the in-memory default).
    if scene.textures.iter().all(Option::is_none) {
        scene.textures.clear();
    }
    // M3b: the first program of a material counts; a scene without any holds no list.
    for (material, p) in programs {
        let i = material as usize;
        if scene.programs.len() <= i {
            scene.programs.resize(i + 1, None);
        }
        if scene.programs[i].is_none() {
            scene.programs[i] = Some(Arc::new(p));
        }
    }
    // The flag says only what the images, the blocks and the programs do not: a file whose
    // meshes carried their UV sets without any of them.
    scene.textured = textured
        && scene.images.is_empty()
        && scene.textures.is_empty()
        && scene.programs.is_empty();
    // S3: the front glass, laid out for this camera (its traced lens prepared).
    scene.glass = glass.map(|(p, layout)| FrontGlass::laid_out(p, layout, &camera));
    scene.camera = camera;
    scene.environment = environment;
    scene.floor = floor.unwrap_or_default();
    scene.render = render;
    scene.effects = effects;
    scene.section = section;
    // S3c: the weather of the instances, and the caps of their drops.
    scene.wet_parts = wet;
    scene.attach_caps();
    scene.apply_section();
    Ok(scene)
}

impl Scene {
    /// Parses an RSB file. See the [module documentation](self) for the format.
    pub fn from_rsb(bytes: &[u8]) -> Result<Scene, RsbError> {
        read_scene(bytes, None)
    }

    /// Replaces this scene with the RSB file `bytes`, like [`Scene::from_rsb`], except that a
    /// file **without `MESH` sections keeps the meshes of this scene** (and their BVHs, which are
    /// not built again): its `INST` sections, or the implicit instances of the kept meshes, refer
    /// to them. This is how a host changes the camera, the image size, the instances, the
    /// materials or the lights of a loaded scene without sending its geometry again. Likewise a
    /// file without `BMAP` sections keeps the bitmaps of this scene. A file with `MESH` sections
    /// replaces the geometry, one with `BMAP` sections the bitmaps, exactly like
    /// [`Scene::from_rsb`]. On error the scene is unchanged.
    pub fn update_from_rsb(&mut self, bytes: &[u8]) -> Result<(), RsbError> {
        let kept = Kept {
            geometry: &mut self.geometry,
            bitmaps: &mut self.bitmaps,
            images: &mut self.images,
            lens: self.camera.lens.as_ref(),
            caps: self.caps,
        };
        let scene = read_scene(bytes, Some(kept))?;
        *self = scene;
        Ok(())
    }

    /// Serialises the scene as an RSB file (the reference writer for the TypeScript side).
    pub fn to_rsb(&self) -> Vec<u8> {
        let mut w = Writer { buf: Vec::new() };
        // M2b: a scene with texture data writes it as the page does: every mesh's UV sets, the
        // texture block of every material that has one, the images.
        let textured = self.textured
            || !self.images.is_empty()
            || self.textures.iter().any(Option::is_some)
            || self.programs.iter().any(Option::is_some);
        w.buf.extend_from_slice(&MAGIC);
        w.u32(0); // header_len

        w.section(TAG_CAMR, |w| {
            let c = &self.camera;
            w.vec3(c.position);
            w.vec3(c.target);
            w.vec3(c.up);
            w.f32(c.focal_mm);
            w.f32(c.sensor_mm);
            w.f32(c.fstop);
            w.f32(c.focus_dist);
            w.u32(u32::from(c.ortho));
            w.f32(c.ortho_width);
            // K3: only when set, so the files of before keep their bytes.
            if c.projection != Projection::Standard
                || c.fov_x_deg != 360.0
                || c.fov_y_deg != 180.0
                || c.exterior != 1.0
            {
                w.u32(c.projection.to_u32());
                w.f32(c.fov_x_deg);
                w.f32(c.fov_y_deg);
                w.f32(c.exterior);
            }
        });
        if let Some(lens) = &self.camera.lens {
            w.section(TAG_LENS, |w| {
                let p = lens.params();
                w.u32(p.blades);
                w.f32(p.roundness);
                w.f32(p.rotation_deg);
                w.u32(p.profile);
                for v in [
                    p.profile_param,
                    p.obstruction,
                    p.cats_eye,
                    p.squeeze,
                    p.shift_x_mm,
                    p.shift_y_mm,
                    p.tilt_deg,
                    p.tilt_axis_deg,
                    p.ca_amount,
                    p.swirl,
                    p.field_mm,
                ] {
                    w.f32(v);
                }
                w.u32(p.mask_kind);
                w.u32(p.mask_width);
                w.u32(p.mask_height);
                w.buf.extend_from_slice(&p.mask);
                let pad = (4 - p.mask.len() % 4) % 4;
                w.buf.extend(std::iter::repeat_n(0u8, pad));
                // O3a: the filters only when there are any, so an O1 lens writes the O1 bytes (and
                // before a prescription, which follows them).
                if p.filters.iter().any(|f| *f != FilterParams::default())
                    || p.prescription.is_some()
                {
                    for f in &p.filters {
                        w.u32(f.kind);
                        w.f32(f.grade);
                        for v in f.tint {
                            w.f32(v);
                        }
                        w.f32(f.angle_deg);
                        w.u32(f.points);
                    }
                }
                if let Some(t) = &p.prescription {
                    w.buf.extend_from_slice(&prescription_bytes(t));
                    // F1: the frame's sensor, only when the image covers more than the frame.
                    if p.frame_sensor_mm != 0.0 {
                        w.f32(p.frame_sensor_mm);
                    }
                }
            });
        }
        // S3: the front glass, right after the camera's optics, only when there is one.
        if let Some(glass) = &self.glass {
            w.section(TAG_GLAS, |w| w.buf.extend_from_slice(&glass.encode()));
        }
        for (index, m) in self.file_materials().iter().enumerate() {
            w.section(TAG_MATL, |w| {
                w.u32(m.kind);
                w.rgb(m.base_color);
                for v in [
                    m.metallic,
                    m.roughness,
                    m.ior,
                    m.transmission,
                    m.coat,
                    m.coat_roughness,
                ] {
                    w.f32(v);
                }
                w.rgb(m.emission);
                w.f32(m.emission_power);
                w.u32(m.flags);
                w.f32(m.opacity);
                w.f32(m.anisotropy);
                w.f32(m.absorption_mm);
                w.f32(m.bevel_mm);
                w.f32(m.scatter_mm);
                w.rgb(m.scatter_color);
                w.f32(m.scatter_g);
                w.f32(m.abbe);
                if let Some(Some(t)) = self.textures.get(index) {
                    w.texture_block(t);
                }
            });
        }
        for p in &self.patterns {
            w.section(TAG_PATN, |w| {
                w.u32(p.material);
                w.u32(p.kind);
                w.rgb(p.color_a);
                w.rgb(p.color_b);
                w.f32(p.scale_mm);
                for v in p.params {
                    w.f32(v);
                }
                w.u32(p.variant);
                w.u32(p.seed);
            });
        }
        for mesh in self.file_meshes() {
            w.section(TAG_MESH, |w| {
                let n = mesh.vertex_count();
                w.u32(n as u32);
                w.u32(mesh.indices().len() as u32);
                for i in 0..n {
                    w.vec3(mesh.position(i).unwrap_or_default());
                }
                for i in 0..n {
                    w.vec3(mesh.normal(i).unwrap_or_default());
                }
                for &i in mesh.indices() {
                    w.u32(i);
                }
                w.u32(mesh.material_id());
                if textured {
                    w.u32(mesh.uv_sets() as u32);
                    for set in 0..mesh.uv_sets() {
                        for i in 0..n {
                            let [u, v] = mesh.uv(set, i).unwrap_or_default();
                            w.f32(u);
                            w.f32(v);
                        }
                    }
                }
            });
        }
        if !self.geometry.has_implicit_instances() {
            for instance in self.file_instances() {
                w.section(TAG_INST, |w| {
                    w.u32(instance.mesh);
                    for v in instance.transform.rows.iter().flatten() {
                        w.f32(*v);
                    }
                    w.u32(instance.material_id);
                    w.u32(instance.flags);
                });
            }
        }
        // S3c: the weather of the instances, after them.
        for part in &self.wet_parts {
            w.section(TAG_WETP, |w| w.buf.extend_from_slice(&part.encode()));
        }
        // L5: the profiles the IES lights use, once each, in the order of first use. An IES light
        // without one is ignored by the engine and so is not written.
        let mut profiles: Vec<&Arc<IesProfile>> = Vec::new();
        for l in &self.lights {
            if l.kind == LightKind::Ies {
                let Some(p) = &l.ies else { continue };
                if !profiles.iter().any(|q| q.source() == p.source()) {
                    profiles.push(p);
                }
            }
        }
        for l in &self.lights {
            if l.kind == LightKind::Ies && l.ies.is_none() {
                continue;
            }
            w.section(TAG_LGHT, |w| {
                w.u32(l.kind.to_u32());
                w.vec3(l.position);
                w.vec3(l.direction);
                w.vec3(l.up);
                w.f32(l.size_x);
                w.f32(l.size_y);
                w.rgb(l.color);
                w.f32(l.power);
                w.f32(l.spread_deg);
                w.f32(l.angle_deg);
                w.u32(l.flags);
                if l.kind == LightKind::Ies {
                    // (Such a light has its profile: the others are skipped above.)
                    let at = l
                        .ies
                        .as_ref()
                        .and_then(|p| profiles.iter().position(|q| q.source() == p.source()));
                    w.u32(at.map_or(NO_PROFILE, |i| i as u32));
                }
            });
        }
        for p in &profiles {
            w.section(TAG_IESP, |w| {
                w.u32(p.source().len() as u32);
                w.buf.extend_from_slice(p.source());
                let pad = (4 - p.source().len() % 4) % 4;
                w.buf.extend(std::iter::repeat_n(0u8, pad));
            });
        }
        for e in &self.effects {
            w.section(TAG_FXAM, |w| w.buf.extend_from_slice(&e.encode()));
        }
        if let Some(plane) = &self.section {
            w.section(TAG_SECT, |w| {
                w.u32(u32::from(plane.cap) * SECTION_CAP);
                w.vec3(plane.normal);
                w.f32(plane.distance);
            });
        }
        if !self.images.is_empty() {
            w.section(TAG_IMGS, |w| {
                w.u32(self.images.len() as u32);
                for image in &self.images {
                    w.u32(image.width());
                    w.u32(image.height());
                    w.u32(image.channels());
                    w.u32(image.color_space());
                    let data = image.pixels();
                    w.buf.extend_from_slice(data);
                    let pad = (4 - data.len() % 4) % 4;
                    w.buf.extend(std::iter::repeat_n(0u8, pad));
                }
            });
        }
        for b in &self.bitmaps {
            w.section(TAG_BMAP, |w| {
                w.u32(b.format);
                w.u32(b.width);
                w.u32(b.height);
                w.u32(b.data.len() as u32);
                w.buf.extend_from_slice(&b.data);
                let pad = (4 - b.data.len() % 4) % 4;
                w.buf.extend(std::iter::repeat_n(0u8, pad));
            });
        }
        w.section(TAG_ENVR, |w| {
            let e = &self.environment;
            w.u32(e.kind.to_u32());
            for v in [e.floor, e.horizon, e.zenith, e.strength, e.rotation_deg] {
                w.f32(v);
            }
            w.rgb(e.background_color);
            w.u32(e.background_mode);
            w.u32(e.hdri_map);
            w.u32(e.backplate_map);
            w.u32(e.backplate_fit);
            w.f32(e.sky_turbidity);
            w.f32(e.sun_azimuth_deg);
            w.f32(e.sun_elevation_deg);
            for v in e.backplate_rect {
                w.f32(v);
            }
            w.u32(e.sky_model.to_u32());
        });
        w.section(TAG_FLOR, |w| {
            let f = &self.floor;
            w.u32(f.mode.to_u32());
            w.f32(f.z);
            w.rgb(f.color);
        });
        w.section(TAG_RNDR, |w| {
            let r = &self.render;
            w.u32(r.width);
            w.u32(r.height);
            w.u32(r.max_samples);
            w.u32(r.seed);
            w.f32(r.max_seconds);
            w.f32(r.exposure_ev);
            w.u32(r.tonemap);
            w.u32(r.max_depth);
            w.f32(r.clamp_indirect);
            w.u32(r.passes);
            w.u32(r.denoise);
            w.u32(r.caustic_photons);
            w.f32(r.caustic_radius);
            w.f32(r.denoise_strength);
            w.u32(r.pixel_filter);
            w.u32(r.edge_supersample);
            // E10: only when adaptive sampling is asked for (or a threshold is set): without
            // it the section is the 64 bytes of E11, byte for byte.
            if r.adaptive != 0 || r.noise_threshold != 0.0 {
                w.u32(r.adaptive);
                w.f32(r.noise_threshold);
            }
        });
        // M3b: the materials' programs, last.
        for (index, p) in self.programs.iter().enumerate() {
            if let Some(p) = p {
                w.section(TAG_PROG, |w| {
                    w.u32(index as u32);
                    w.buf.extend_from_slice(&p.encode());
                });
            }
        }
        w.buf
    }
}

/// Little-endian byte sink.
struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn vec3(&mut self, v: Vec3) {
        self.f32(v.x);
        self.f32(v.y);
        self.f32(v.z);
    }

    fn rgb(&mut self, c: Rgb) {
        self.f32(c.r);
        self.f32(c.g);
        self.f32(c.b);
    }

    /// The texture block of a `MATL` (M2b), from byte 100: its version, six slots, the emission
    /// tint, the labels.
    fn texture_block(&mut self, t: &MaterialTextures) {
        let image = |i: Option<u32>| i.unwrap_or(u32::MAX);
        self.u32(crate::texture::TEXTURE_BLOCK_VERSION);
        for s in &t.slots {
            self.u32(image(s.image));
            self.u32(s.projection);
            self.u32(s.axis);
            self.u32(s.uv_set);
            self.f32(s.size_mm);
            self.f32(s.rotation_deg);
            self.f32(s.offset[0]);
            self.f32(s.offset[1]);
            self.f32(s.repeat[0]);
            self.f32(s.repeat[1]);
            self.u32(s.wrap);
            self.u32(s.channel);
            self.u32(s.flags);
            self.f32(s.strength);
            self.f32(s.cutoff);
        }
        self.rgb(t.emission_tint);
        self.u32(t.labels.len() as u32);
        for l in &t.labels {
            self.u32(image(l.image));
            self.vec3(l.origin);
            self.vec3(l.u);
            self.vec3(l.v);
            self.vec3(l.normal);
            for v in [
                l.width_mm,
                l.height_mm,
                l.depth_mm,
                l.roughness,
                l.coat,
                l.relief,
            ] {
                self.f32(v);
            }
        }
    }

    /// Writes a section: tag, a length patched in after `body` ran, then the payload.
    fn section(&mut self, tag: [u8; 4], body: impl FnOnce(&mut Writer)) {
        self.buf.extend_from_slice(&tag);
        let len_at = self.buf.len();
        self.u32(0);
        let start = self.buf.len();
        body(self);
        let len = (self.buf.len() - start) as u32;
        self.buf[len_at..len_at + 4].copy_from_slice(&len.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ies::IesError;
    use crate::scene::{LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY};

    /// A scene that exercises every section with non-default values.
    fn full_scene() -> Scene {
        Scene {
            camera: Camera {
                position: Vec3::new(10.0, -200.0, 50.0),
                target: Vec3::new(1.0, 2.0, 3.0),
                up: Vec3::new(0.0, 0.0, 1.0),
                focal_mm: 85.0,
                sensor_mm: 36.0,
                fstop: 5.6,
                focus_dist: 212.5,
                ortho: true,
                ortho_width: 320.0,
                lens: None,
                ..Camera::default()
            },
            materials: vec![
                Material::default(),
                Material {
                    kind: 2,
                    base_color: Rgb::new(0.9, 0.5, 0.1),
                    metallic: 1.0,
                    roughness: 0.2,
                    ior: 1.33,
                    transmission: 0.25,
                    coat: 0.5,
                    coat_roughness: 0.05,
                    emission: Rgb::new(1.0, 0.9, 0.8),
                    emission_power: 12.0,
                    flags: 1,
                    opacity: 0.75,
                    anisotropy: 0.4,
                    absorption_mm: 25.0,
                    bevel_mm: 0.35,
                    scatter_mm: 2.5,
                    scatter_color: Rgb::new(0.9, 0.8, 0.7),
                    scatter_g: -0.3,
                    abbe: 42.0,
                },
            ],
            geometry: Geometry::from_meshes(vec![
                Mesh::new(
                    &[
                        Vec3::new(0.0, 0.0, 0.0),
                        Vec3::new(1.0, 0.0, 0.0),
                        Vec3::new(0.0, 1.0, 0.0),
                        Vec3::new(1.0, 1.0, 0.0),
                    ],
                    &[Vec3::new(0.0, 0.0, 1.0); 4],
                    &[0, 1, 2, 2, 1, 3],
                    1,
                )
                .unwrap(),
                Mesh::new(
                    &[Vec3::new(5.0, 5.0, 5.0); 3],
                    &[Vec3::ZERO; 3],
                    &[0, 1, 2],
                    0,
                )
                .unwrap(),
            ]),
            lights: vec![
                Light::default(),
                Light {
                    kind: LightKind::Sun,
                    position: Vec3::new(1.0, 2.0, 3.0),
                    direction: Vec3::new(0.3, 0.2, -0.9),
                    up: Vec3::new(0.0, 1.0, 0.0),
                    size_x: 10.0,
                    size_y: 20.0,
                    color: Rgb::new(1.0, 0.95, 0.9),
                    power: 3.5,
                    spread_deg: 45.0,
                    angle_deg: 0.53,
                    flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
                    ies: None,
                },
                Light {
                    kind: LightKind::Disk,
                    flags: 0,
                    ..Light::default()
                },
                Light {
                    kind: LightKind::Spot,
                    spread_deg: 30.0,
                    ..Light::default()
                },
            ],
            environment: Environment {
                kind: EnvKind::Flat,
                floor: 0.2,
                horizon: 0.4,
                zenith: 0.8,
                strength: 1.5,
                rotation_deg: 90.0,
                background_color: Rgb::new(0.1, 0.2, 0.3),
                background_mode: 1,
                hdri_map: 1,
                backplate_map: 0,
                backplate_fit: crate::scene::BACKPLATE_FIT,
                sky_turbidity: 4.5,
                sky_model: SkyModel::Classic,
                sun_azimuth_deg: -30.0,
                sun_elevation_deg: 12.0,
                backplate_rect: [0.1, 0.05, 0.9, 0.95],
            },
            floor: Floor {
                mode: FloorMode::ShadowCatcher,
                z: -12.5,
                color: Rgb::new(0.4, 0.5, 0.6),
            },
            render: RenderSettings {
                width: 1920,
                height: 1080,
                max_samples: 256,
                seed: 77,
                max_seconds: 12.5,
                exposure_ev: -0.5,
                tonemap: 3,
                max_depth: 12,
                clamp_indirect: 10.0,
                passes: 0b10_1101,
                denoise: 3,
                caustic_photons: 4096,
                caustic_radius: 2.5,
                denoise_strength: 0.25,
                pixel_filter: 3,
                edge_supersample: 4,
                adaptive: 1,
                noise_threshold: 0.02,
            },
            bitmaps: test_bitmaps(),
            patterns: vec![crate::pattern::Pattern {
                material: 1,
                kind: crate::pattern::PATTERN_WOOD,
                color_a: Rgb::new(0.7, 0.5, 0.3),
                color_b: Rgb::new(0.3, 0.2, 0.1),
                scale_mm: 4.5,
                params: [
                    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 3.0, 12.5, 0.25, 0.75, 0.0,
                    0.0,
                ],
                variant: 7,
                seed: 0xdead_beef,
            }],
            effects: Vec::new(),
            ..Scene::default()
        }
    }

    /// A raw sRGB plate (odd byte length: padded in the file) and a little Radiance HDR file.
    fn test_bitmaps() -> Vec<Bitmap> {
        let plate = Bitmap::decode(
            crate::bitmap::FORMAT_RGB8,
            3,
            1,
            vec![10, 20, 30, 40, 50, 60, 70, 80, 90],
        )
        .unwrap();
        let rgb: Vec<f32> = (0..3 * 8 * 2).map(|i| i as f32 * 0.25).collect();
        let file = crate::hdr::encode(8, 2, &rgb);
        let hdr = Bitmap::decode(crate::bitmap::FORMAT_HDR, 0, 0, file).unwrap();
        vec![plate, hdr]
    }

    /// Splits a serialised file into its sections `(tag, payload)`.
    fn sections(bytes: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        let mut pos = 8;
        let mut out = Vec::new();
        while pos < bytes.len() {
            let tag = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
            let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
            out.push((tag, bytes[pos + 8..pos + 8 + len].to_vec()));
            pos += 8 + len;
        }
        out
    }

    fn unknown_section(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut s = tag.to_vec();
        s.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        s.extend_from_slice(payload);
        s
    }

    #[test]
    fn ambient_effects_are_written_after_the_lights_and_read_back() {
        let scene = crate::example::ambient_scene();
        let bytes = scene.to_rsb();
        let found = sections(&bytes);
        let tags: Vec<[u8; 4]> = found.iter().map(|(t, _)| *t).collect();
        let fxam: Vec<usize> = (0..tags.len()).filter(|&i| tags[i] == TAG_FXAM).collect();
        assert_eq!(fxam.len(), 3);
        assert_eq!(tags[fxam[0] - 1], TAG_LGHT);
        assert_eq!(tags[fxam[2] + 1], TAG_ENVR);
        for &i in &fxam {
            assert_eq!(found[i].1.len(), rt_sim::FXAM_BYTES);
        }
        assert_eq!(Scene::from_rsb(&bytes).as_ref(), Ok(&scene));
        // Without its FXAM sections the file is the example at that size: what a reader that does
        // not know them renders.
        let mut stripped = bytes[..8].to_vec();
        for (tag, payload) in &found {
            if *tag != TAG_FXAM {
                stripped.extend_from_slice(&unknown_section(tag, payload));
            }
        }
        let plain = Scene::from_rsb(&stripped).unwrap();
        assert!(plain.effects.is_empty() && plain.geometry.particle_sets().is_empty());
        let mut expected = crate::example::scene();
        expected.render.width = 160;
        expected.render.height = 120;
        expected.materials = scene.materials.clone();
        assert_eq!(plain, expected);
    }

    #[test]
    fn bad_ambient_effects_are_refused() {
        let scene = crate::example::ambient_scene();
        let bytes = scene.to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = bytes[..8].to_vec();
            let mut first = true;
            for (tag, payload) in sections(&bytes) {
                let mut payload = payload;
                if tag == TAG_FXAM && first {
                    edit(&mut payload);
                    first = false;
                }
                out.extend_from_slice(&unknown_section(&tag, &payload));
            }
            Scene::from_rsb(&out)
        };
        let invalid = |reason| {
            Err(RsbError::Invalid {
                tag: TAG_FXAM,
                reason,
            })
        };
        assert_eq!(
            rebuild(&|p| p[112..116].copy_from_slice(&99u32.to_le_bytes())),
            invalid("material_id does not refer to a MATL section")
        );
        assert_eq!(
            rebuild(&|p| p.truncate(100)),
            Err(RsbError::SectionTooShort { tag: TAG_FXAM })
        );
        assert_eq!(
            rebuild(&|p| p[8..12].copy_from_slice(&f32::NAN.to_le_bytes())),
            invalid("non-finite number")
        );
        assert!(rebuild(&|p| p[48..52].copy_from_slice(&(-1.0f32).to_le_bytes())).is_err());
        // A payload with only the brief's fields reads the rest as defaults.
        let short = rebuild(&|p| p.truncate(rt_sim::FXAM_MIN_BYTES)).unwrap();
        assert_eq!(short.effects[0].gravity, 1.0);
        assert_eq!(short.effects[0].energy, 0.0);
    }

    #[test]
    fn round_trips_every_section() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        assert_eq!(&bytes[..4], b"RSB1");
        assert_eq!(&bytes[4..8], &[0, 0, 0, 0]);
        let tags: Vec<[u8; 4]> = sections(&bytes).into_iter().map(|(t, _)| t).collect();
        assert_eq!(
            tags,
            [
                *b"CAMR", *b"MATL", *b"MATL", *b"PATN", *b"MESH", *b"MESH", *b"LGHT", *b"LGHT",
                *b"LGHT", *b"LGHT", *b"BMAP", *b"BMAP", *b"ENVR", *b"FLOR", *b"RNDR"
            ]
        );
        assert_eq!(Scene::from_rsb(&bytes), Ok(scene));
    }

    #[test]
    fn section_payload_sizes_match_the_documented_layout() {
        let bytes = full_scene().to_rsb();
        let size = |wanted: &[u8; 4]| {
            sections(&bytes)
                .into_iter()
                .find(|(t, _)| t == wanted)
                .map(|(_, p)| p.len())
        };
        assert_eq!(size(b"CAMR"), Some(15 * 4));
        assert_eq!(size(b"MATL"), Some(25 * 4));
        assert_eq!(size(b"LGHT"), Some(19 * 4));
        assert_eq!(size(b"ENVR"), Some(21 * 4));
        // The first bitmap: 16 bytes of header and 9 of data, padded to 12.
        assert_eq!(size(b"BMAP"), Some(16 + 12));
        assert_eq!(size(b"FLOR"), Some(5 * 4));
        // E10: with adaptive sampling asked for, 72 bytes (64 without, as E11 wrote it).
        assert_eq!(size(b"RNDR"), Some(18 * 4));
        assert_eq!(size(b"PATN"), Some(27 * 4));
        // First mesh: 4 vertices, 6 indices: 2 + 4 * 6 + 6 + 1 words.
        assert_eq!(sections(&bytes)[4].1.len(), (2 + 24 + 6 + 1) * 4);
    }

    #[test]
    fn unknown_sections_are_skipped_anywhere() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let parts = sections(&bytes);
        // Rebuild the file with an unknown section before, between and after the known ones.
        let mut spliced = bytes[..8].to_vec();
        spliced.extend(unknown_section(b"XTRA", &[1, 2, 3]));
        for (i, (tag, payload)) in parts.iter().enumerate() {
            spliced.extend(unknown_section(tag, payload));
            if i == 3 {
                spliced.extend(unknown_section(b"\0\0\0\0", &[]));
            }
        }
        spliced.extend(unknown_section(b"FUTR", &[9; 100]));
        assert_eq!(Scene::from_rsb(&spliced), Ok(scene));
    }

    #[test]
    fn extra_header_bytes_and_trailing_section_bytes_are_ignored() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut with_header = bytes[..4].to_vec();
        with_header.extend_from_slice(&6u32.to_le_bytes());
        with_header.extend_from_slice(&[7; 6]);
        with_header.extend_from_slice(&bytes[8..]);
        assert_eq!(Scene::from_rsb(&with_header), Ok(scene.clone()));

        // A newer writer appended a field to RNDR.
        let mut extended = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            if tag == TAG_RNDR {
                payload.extend_from_slice(&42u32.to_le_bytes());
            }
            extended.extend(unknown_section(&tag, &payload));
        }
        assert_eq!(Scene::from_rsb(&extended), Ok(scene));
    }

    #[test]
    fn sections_written_before_e3_read_with_defaults() {
        // MATL without flags (56 B) and RNDR without max_depth and clamp_indirect (28 B), as E1
        // and E2 wrote them; no FLOR section.
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            match tag {
                TAG_MATL => payload.truncate(56),
                TAG_RNDR => payload.truncate(28),
                TAG_FLOR => continue,
                _ => {}
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("old layout reads");
        assert!(read.materials.iter().all(|m| m.flags == 0));
        assert!(read
            .materials
            .iter()
            .all(|m| m.opacity == 1.0 && m.anisotropy == 0.0));
        assert_eq!(read.render.max_depth, RenderSettings::DEFAULT_MAX_DEPTH);
        assert_eq!(read.render.clamp_indirect, 0.0);
        assert_eq!(read.floor, Floor::default());
        assert_eq!(read.render.tonemap, scene.render.tonemap);
        assert_eq!(read.lights, scene.lights);
    }

    #[test]
    fn patterns_must_name_a_material_and_have_a_scale() {
        let good = full_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                if tag == TAG_PATN {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        let stray = rebuild(&|p| p[0..4].copy_from_slice(&2u32.to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&stray),
            Err(RsbError::Invalid { tag: TAG_PATN, .. })
        ));
        let negative = rebuild(&|p| p[32..36].copy_from_slice(&(-1.0f32).to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&negative),
            Err(RsbError::Invalid { tag: TAG_PATN, .. })
        ));
        let short = rebuild(&|p| p.truncate(104));
        assert_eq!(
            Scene::from_rsb(&short),
            Err(RsbError::SectionTooShort { tag: TAG_PATN })
        );
        // A newer kind is read and kept; it draws nothing.
        let newer = rebuild(&|p| p[4..8].copy_from_slice(&9u32.to_le_bytes()));
        let scene = Scene::from_rsb(&newer).expect("newer kind");
        assert_eq!(scene.patterns[0].kind, 9);
    }

    #[test]
    fn materials_written_before_e6_have_sharp_edges() {
        // MATL of 72 B, as E5 to X5 wrote it: no bevel_mm. MATL of 76 B, as E6 wrote it before
        // E9: the bevel, and no medium or dispersion.
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let with_matl = |len: usize| {
            let mut old = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_MATL {
                    assert_eq!(payload.len(), 100);
                    payload.truncate(len);
                }
                old.extend(unknown_section(&tag, &payload));
            }
            Scene::from_rsb(&old).expect("older layout reads")
        };
        let e5 = with_matl(72);
        assert_eq!(e5.materials[1].bevel_mm, 0.0);
        assert_eq!(e5.materials[1].absorption_mm, 25.0);
        assert_eq!(scene.materials[1].bevel_mm, 0.35);
        let e6 = &with_matl(76).materials[1];
        assert_eq!(e6.bevel_mm, 0.35);
        assert_eq!(
            (e6.scatter_mm, e6.scatter_color, e6.scatter_g, e6.abbe),
            (0.0, Rgb::WHITE, 0.0, 0.0)
        );
    }

    #[test]
    fn sections_written_before_e5_read_with_defaults() {
        // MATL of 60 B (no opacity, anisotropy, absorption), ENVR of 40 B, no BMAP.
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            match tag {
                TAG_MATL => payload.truncate(60),
                TAG_ENVR => payload.truncate(40),
                TAG_BMAP => continue,
                _ => {}
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("E4 layout reads");
        assert!(read.bitmaps.is_empty());
        let m = &read.materials[1];
        assert_eq!((m.opacity, m.anisotropy, m.absorption_mm), (1.0, 0.0, 0.0));
        assert_eq!(m.flags, 1);
        assert_eq!(
            (
                m.bevel_mm,
                m.scatter_mm,
                m.scatter_color,
                m.scatter_g,
                m.abbe
            ),
            (0.0, 0.0, Rgb::WHITE, 0.0, 0.0)
        );
        let e = &read.environment;
        assert_eq!(
            (e.hdri_map, e.backplate_map, e.backplate_fit),
            (NO_BITMAP, NO_BITMAP, 0)
        );
        assert_eq!(e.sky_turbidity, crate::sky::DEFAULT_TURBIDITY);
        assert_eq!((e.sun_azimuth_deg, e.sun_elevation_deg), (0.0, 45.0));
        assert_eq!(e.backplate_rect, [0.0, 0.0, 1.0, 1.0]);
        assert_eq!(e.background_mode, scene.environment.background_mode);
        assert_eq!(e.sky_model, SkyModel::Physical);
    }

    #[test]
    fn the_sky_model_is_physical_unless_the_file_says_classic() {
        // An E5 file (ENVR of 80 B) has no sky model: it reads as the default, the physical sky.
        let scene = full_scene();
        assert_eq!(scene.environment.sky_model, SkyModel::Classic);
        let bytes = scene.to_rsb();
        let with_envr = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_ENVR {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            Scene::from_rsb(&out).expect("reads")
        };
        let e5 = with_envr(&|p| p.truncate(80));
        assert_eq!(e5.environment.sky_model, SkyModel::Physical);
        assert_eq!(
            Environment {
                sky_model: SkyModel::Classic,
                ..e5.environment.clone()
            },
            scene.environment
        );
        // The field itself: 1 is classic, 0 and unknown values the physical sky.
        for (value, model) in [
            (0u32, SkyModel::Physical),
            (1, SkyModel::Classic),
            (7, SkyModel::Physical),
        ] {
            let read = with_envr(&|p| p[80..84].copy_from_slice(&value.to_le_bytes()));
            assert_eq!(read.environment.sky_model, model, "{value}");
        }
        assert_eq!(Environment::default().sky_model, SkyModel::Physical);
    }

    #[test]
    fn a_render_section_without_the_strength_hands_out_all_of_the_denoised_image() {
        // U11b: RNDR of 52 B (E5b-1 to U11) reads a strength of 1; out of 0..=1 is invalid.
        let scene = full_scene();
        assert_eq!(scene.render.denoise_strength, 0.25);
        let bytes = scene.to_rsb();
        let rewrite = |cut: Option<usize>, value: Option<f32>| {
            let mut out = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_RNDR {
                    assert_eq!(payload[52..56], 0.25f32.to_le_bytes());
                    if let Some(v) = value {
                        payload[52..56].copy_from_slice(&v.to_le_bytes());
                    }
                    if let Some(n) = cut {
                        payload.truncate(n);
                    }
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        assert_eq!(
            Scene::from_rsb(&bytes).unwrap().render.denoise_strength,
            0.25
        );
        let old = Scene::from_rsb(&rewrite(Some(52), None)).expect("E5b-1 layout reads");
        assert_eq!(old.render.denoise_strength, 1.0);
        assert_eq!(old.render.denoise, scene.render.denoise);
        for bad in [-0.1f32, 1.5, f32::NAN] {
            assert!(
                matches!(
                    Scene::from_rsb(&rewrite(None, Some(bad))),
                    Err(RsbError::Invalid { tag: TAG_RNDR, .. })
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_render_section_without_the_pixel_filter_renders_as_before() {
        // E11: RNDR of 56 B (U11b) reads the box filter and no edge samples; more than 16 edge
        // samples is invalid; an unknown filter is kept (it renders as the box).
        let scene = full_scene();
        assert_eq!(
            (scene.render.pixel_filter, scene.render.edge_supersample),
            (3, 4)
        );
        let bytes = scene.to_rsb();
        let rewrite = |cut: Option<usize>, filter: Option<u32>, edges: Option<u32>| {
            let mut out = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_RNDR {
                    assert_eq!(payload[56..60], 3u32.to_le_bytes());
                    assert_eq!(payload[60..64], 4u32.to_le_bytes());
                    if let Some(v) = filter {
                        payload[56..60].copy_from_slice(&v.to_le_bytes());
                    }
                    if let Some(v) = edges {
                        payload[60..64].copy_from_slice(&v.to_le_bytes());
                    }
                    if let Some(n) = cut {
                        payload.truncate(n);
                    }
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        let old = Scene::from_rsb(&rewrite(Some(56), None, None)).expect("U11b layout reads");
        assert_eq!(
            (old.render.pixel_filter, old.render.edge_supersample),
            (0, 1)
        );
        assert_eq!(old.render.denoise_strength, 0.25);
        let odd = Scene::from_rsb(&rewrite(None, Some(77), Some(0))).expect("reads");
        assert_eq!((odd.render.pixel_filter, odd.render.edge_factor()), (77, 1));
        assert_eq!(
            Scene::from_rsb(&rewrite(None, None, Some(16)))
                .unwrap()
                .render
                .edge_factor(),
            16
        );
        assert!(matches!(
            Scene::from_rsb(&rewrite(None, None, Some(17))),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));
    }

    #[test]
    fn a_render_section_without_adaptive_sampling_is_the_one_of_e11() {
        // E10: the writer adds `adaptive` and `noise_threshold` only when one is set, so a scene
        // without them is the 64 bytes of E11 byte for byte; a file of 64 B reads them off; an
        // unknown bit of `adaptive` is kept; a threshold outside 0..=1 is invalid.
        let mut scene = full_scene();
        assert_eq!(
            (scene.render.adaptive, scene.render.noise_threshold),
            (1, 0.02)
        );
        let bytes = scene.to_rsb();
        let rndr = |bytes: &[u8]| {
            sections(bytes)
                .into_iter()
                .find(|(t, _)| *t == TAG_RNDR)
                .map(|(_, p)| p)
                .expect("RNDR")
        };
        let payload = rndr(&bytes);
        assert_eq!(payload.len(), 72);
        assert_eq!(payload[64..68], 1u32.to_le_bytes());
        assert_eq!(payload[68..72], 0.02f32.to_le_bytes());
        let rewrite = |f: &dyn Fn(&mut Vec<u8>)| {
            let mut out = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_RNDR {
                    f(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        let old = Scene::from_rsb(&rewrite(&|p| p.truncate(64))).expect("E11 layout reads");
        assert_eq!((old.render.adaptive, old.render.noise_threshold), (0, 0.0));
        let flag_only = Scene::from_rsb(&rewrite(&|p| p.truncate(68))).expect("reads");
        assert_eq!(
            (flag_only.render.adaptive, flag_only.render.noise_threshold),
            (1, 0.0)
        );
        let odd = Scene::from_rsb(&rewrite(&|p| {
            p[64..68].copy_from_slice(&6u32.to_le_bytes())
        }))
        .expect("reads");
        assert_eq!(odd.render.adaptive, 6);
        assert!(!crate::adaptive::Adaptive::enabled(&odd.render));
        for bad in [-0.01f32, 1.5, f32::NAN] {
            assert!(
                matches!(
                    Scene::from_rsb(&rewrite(&|p| p[68..72].copy_from_slice(&bad.to_le_bytes()))),
                    Err(RsbError::Invalid { tag: TAG_RNDR, .. })
                ),
                "{bad}"
            );
        }
        // Off, the section is E11's again.
        scene.render.adaptive = 0;
        scene.render.noise_threshold = 0.0;
        let plain = scene.to_rsb();
        assert_eq!(rndr(&plain).len(), 64);
        assert_eq!(rndr(&plain)[..], payload[..64]);
    }

    #[test]
    fn a_render_section_written_before_e5b_has_no_denoise_and_no_caustics() {
        // RNDR of 40 B (X2 to E5c): denoise off, no caustic photons, the default radius.
        let scene = full_scene();
        assert_ne!(scene.render.caustic_photons, 0);
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            if tag == TAG_RNDR {
                assert_eq!(payload[40..44], scene.render.denoise.to_le_bytes());
                assert_eq!(payload[44..48], scene.render.caustic_photons.to_le_bytes());
                assert_eq!(payload[48..52], scene.render.caustic_radius.to_le_bytes());
                payload.truncate(40);
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("X2 layout reads");
        assert_eq!(read.render.passes, scene.render.passes);
        assert_eq!(read.render.denoise, 0);
        assert_eq!(read.render.caustic_photons, 0);
        assert_eq!(read.render.caustic_radius, 0.0);
        // Too many photons, or a negative radius, is an invalid file.
        for (field, bad) in [
            (
                44usize,
                (RenderSettings::MAX_CAUSTIC_PHOTONS + 1).to_le_bytes(),
            ),
            (48, (-1.0f32).to_le_bytes()),
        ] {
            let mut file = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_RNDR {
                    payload[field..field + 4].copy_from_slice(&bad);
                }
                file.extend(unknown_section(&tag, &payload));
            }
            assert!(matches!(
                Scene::from_rsb(&file),
                Err(RsbError::Invalid { tag: TAG_RNDR, .. })
            ));
        }
    }

    #[test]
    fn a_render_section_written_before_x2_asks_for_no_passes() {
        // RNDR of 36 B (no pass mask), as E3 to E5 wrote it.
        let scene = full_scene();
        assert_ne!(scene.render.passes, 0);
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            if tag == TAG_RNDR {
                // 72 with the adaptive fields of E10 (the full scene asks for them).
                assert_eq!(payload.len(), 72);
                assert_eq!(payload[36..40], scene.render.passes.to_le_bytes());
                payload.truncate(36);
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("E5 layout reads");
        assert_eq!(read.render.passes, 0);
        assert_eq!(read.render.clamp_indirect, scene.render.clamp_indirect);
        assert_eq!(
            (
                read.render.denoise,
                read.render.caustic_photons,
                read.render.caustic_radius
            ),
            (0, 0, 0.0)
        );
        // Bits nobody knows yet are kept as they are (a newer writer's passes).
        let mut newer = scene.clone();
        newer.render.passes = 0xffff_ffff;
        assert_eq!(Scene::from_rsb(&newer.to_rsb()), Ok(newer));
    }

    #[test]
    fn bitmaps_must_decode_and_be_referred_to_correctly() {
        let good = full_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        // A raw plate whose size does not match its bytes.
        let bad_size = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 0 {
                p[4..8].copy_from_slice(&7u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_size),
            Err(RsbError::Invalid { tag: TAG_BMAP, .. })
        ));
        // A byte length beyond the section.
        let long = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 0 {
                p[12..16].copy_from_slice(&1000u32.to_le_bytes());
            }
        });
        assert_eq!(
            Scene::from_rsb(&long),
            Err(RsbError::SectionTooShort { tag: TAG_BMAP })
        );
        // A broken HDR file.
        let broken = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 16 {
                p[16] = b'X';
            }
        });
        assert!(matches!(
            Scene::from_rsb(&broken),
            Err(RsbError::Invalid { tag: TAG_BMAP, .. })
        ));
        // The environment refers to a bitmap that is not there.
        let dangling = rebuild(&|tag, p| {
            if *tag == TAG_ENVR {
                p[40..44].copy_from_slice(&2u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&dangling),
            Err(RsbError::Invalid { tag: TAG_ENVR, .. })
        ));
    }

    #[test]
    fn updates_without_bitmaps_keep_the_loaded_ones() {
        let mut scene = full_scene();
        let mut next = full_scene();
        next.environment.strength = 3.0;
        next.environment.rotation_deg = 45.0;
        let update: Vec<u8> = {
            let bytes = next.to_rsb();
            let mut out = bytes[..8].to_vec();
            for (tag, payload) in sections(&bytes) {
                if tag != TAG_BMAP && tag != TAG_MESH {
                    out.extend(unknown_section(&tag, &payload));
                }
            }
            out
        };
        assert!(Scene::from_rsb(&update).is_err(), "alone its maps dangle");
        scene.update_from_rsb(&update).expect("update");
        assert_eq!(scene, next);
        // New bitmaps replace the loaded ones, the meshes stay.
        let mut other = full_scene();
        other.bitmaps.swap(0, 1);
        other.environment.hdri_map = 0;
        other.environment.backplate_map = 1;
        let bytes = other.to_rsb();
        let mut no_mesh = bytes[..8].to_vec();
        for (tag, payload) in sections(&bytes) {
            if tag != TAG_MESH {
                no_mesh.extend(unknown_section(&tag, &payload));
            }
        }
        scene
            .update_from_rsb(&no_mesh)
            .expect("update with bitmaps");
        assert_eq!(scene, other);
    }

    #[test]
    fn reserved_kinds_round_trip_and_bad_floors_fail() {
        // Point and spot lights (L4), sky and HDRI environments (E5) are kept verbatim.
        let mut scene = full_scene();
        scene.lights.push(Light {
            kind: LightKind::Point,
            ..Light::default()
        });
        scene.environment.kind = EnvKind::Hdri;
        scene.environment.background_mode = 3;
        scene.materials[0].kind = 1;
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene.clone()));
        scene.environment.kind = EnvKind::Sky;
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene.clone()));

        let good = scene.to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                if tag == TAG_FLOR {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        assert!(matches!(
            Scene::from_rsb(&rebuild(&|p| p[0..4].copy_from_slice(&3u32.to_le_bytes()))),
            Err(RsbError::Invalid { tag: TAG_FLOR, .. })
        ));
        assert_eq!(
            Scene::from_rsb(&rebuild(&|p| p.truncate(12))),
            Err(RsbError::SectionTooShort { tag: TAG_FLOR })
        );
        let mut doubled = good.clone();
        let flor = sections(&good)
            .into_iter()
            .find(|(t, _)| *t == TAG_FLOR)
            .unwrap();
        doubled.extend(unknown_section(&flor.0, &flor.1));
        assert_eq!(
            Scene::from_rsb(&doubled),
            Err(RsbError::DuplicateSection { tag: TAG_FLOR })
        );
    }

    #[test]
    fn missing_singleton_sections_mean_defaults() {
        let bytes = Scene::default().to_rsb();
        let only_header = bytes[..8].to_vec();
        assert_eq!(Scene::from_rsb(&only_header), Ok(Scene::default()));
    }

    #[test]
    fn rejects_bad_magic_and_short_input() {
        assert_eq!(Scene::from_rsb(b""), Err(RsbError::BadMagic));
        assert_eq!(Scene::from_rsb(b"RSB2\0\0\0\0"), Err(RsbError::BadMagic));
        assert_eq!(
            Scene::from_rsb(b"RSB1"),
            Err(RsbError::Truncated { what: "header" })
        );
        // header_len points past the end of the file.
        assert_eq!(
            Scene::from_rsb(b"RSB1\x10\0\0\0abc"),
            Err(RsbError::Truncated { what: "header" })
        );
    }

    #[test]
    fn truncation_never_panics_and_cuts_inside_a_section_fail() {
        let bytes = full_scene().to_rsb();
        let boundaries: Vec<usize> = {
            let mut b = vec![8];
            for (_, p) in sections(&bytes) {
                b.push(b.last().unwrap() + 8 + p.len());
            }
            b
        };
        for cut in 0..bytes.len() {
            let result = Scene::from_rsb(&bytes[..cut]);
            if boundaries.contains(&cut) && cut >= 8 {
                // A clean cut between sections is a valid, smaller file, unless a mesh now
                // refers to a material that was cut away.
                continue;
            }
            assert!(result.is_err(), "cut at {cut} should fail");
        }
    }

    #[test]
    fn rejects_duplicate_singletons() {
        let bytes = full_scene().to_rsb();
        let camr = sections(&bytes)
            .into_iter()
            .find(|(t, _)| *t == TAG_CAMR)
            .unwrap();
        let mut doubled = bytes.clone();
        doubled.extend(unknown_section(&camr.0, &camr.1));
        assert_eq!(
            Scene::from_rsb(&doubled),
            Err(RsbError::DuplicateSection { tag: TAG_CAMR })
        );
    }

    #[test]
    fn rejects_short_payloads_and_bad_values() {
        let good = full_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };

        let short_camera = rebuild(&|tag, p| {
            if *tag == TAG_CAMR {
                p.truncate(20);
            }
        });
        assert_eq!(
            Scene::from_rsb(&short_camera),
            Err(RsbError::SectionTooShort { tag: TAG_CAMR })
        );

        let nan = rebuild(&|tag, p| {
            if *tag == TAG_MATL {
                p[4..8].copy_from_slice(&f32::NAN.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&nan),
            Err(RsbError::Invalid { tag: TAG_MATL, .. })
        ));

        let negative_clamp = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[32..36].copy_from_slice(&(-1.0f32).to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&negative_clamp),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let zero_width = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[0..4].copy_from_slice(&0u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&zero_width),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let huge = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[4..8].copy_from_slice(&1_000_000u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&huge),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let bad_light = rebuild(&|tag, p| {
            if *tag == TAG_LGHT {
                p[0..4].copy_from_slice(&9u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_light),
            Err(RsbError::Invalid { tag: TAG_LGHT, .. })
        ));

        let bad_env = rebuild(&|tag, p| {
            if *tag == TAG_ENVR {
                p[0..4].copy_from_slice(&5u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_env),
            Err(RsbError::Invalid { tag: TAG_ENVR, .. })
        ));

        let bad_focal = rebuild(&|tag, p| {
            if *tag == TAG_CAMR {
                p[36..40].copy_from_slice(&0.0f32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_focal),
            Err(RsbError::Invalid { tag: TAG_CAMR, .. })
        ));
    }

    #[test]
    fn rejects_inconsistent_meshes() {
        let mesh_bytes = |vertices: u32, indices: &[u32], material: u32| {
            let mut file = b"RSB1\0\0\0\0".to_vec();
            let mut p = Vec::new();
            p.extend_from_slice(&vertices.to_le_bytes());
            p.extend_from_slice(&(indices.len() as u32).to_le_bytes());
            p.extend(vec![0u8; vertices as usize * 24]);
            for i in indices {
                p.extend_from_slice(&i.to_le_bytes());
            }
            p.extend_from_slice(&material.to_le_bytes());
            file.extend(unknown_section(&TAG_MESH, &p));
            file.extend(unknown_section(&TAG_MATL, &Material::to_bytes_for_test()));
            file
        };
        assert!(Scene::from_rsb(&mesh_bytes(3, &[0, 1, 2], 0)).is_ok());
        // Index out of range.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1, 3], 0)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        // Not a multiple of three.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1], 0)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        // Unknown material.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1, 2], 1)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
    }

    /// `full_scene` with explicit instances: the first mesh twice, the second once.
    fn instanced_scene() -> Scene {
        let mut scene = full_scene();
        let meshes = scene.geometry.meshes().to_vec();
        let moved = Transform::from_rows([
            [0.0, -1.0, 0.0, 10.0],
            [2.0, 0.0, 0.0, -5.0],
            [0.0, 0.0, 0.5, 1.25],
        ]);
        let instances = vec![
            Instance::new(0, Transform::IDENTITY, 1),
            Instance {
                flags: crate::scene::INSTANCE_ONE_SIDED,
                ..Instance::new(0, moved, 0)
            },
            Instance::new(1, Transform::translation(Vec3::new(1.0, 2.0, 3.0)), 1),
        ];
        scene.geometry = Geometry::new(meshes, instances).unwrap();
        scene
    }

    #[test]
    fn instances_round_trip_and_implicit_ones_are_not_written() {
        let scene = instanced_scene();
        let bytes = scene.to_rsb();
        let inst: Vec<Vec<u8>> = sections(&bytes)
            .into_iter()
            .filter(|(t, _)| *t == TAG_INST)
            .map(|(_, p)| p)
            .collect();
        assert_eq!(inst.len(), 3);
        assert!(inst.iter().all(|p| p.len() == 15 * 4));
        assert_eq!(Scene::from_rsb(&bytes), Ok(scene));
        // Without explicit instances the file has no INST section and reads back the same.
        let plain = full_scene().to_rsb();
        assert!(sections(&plain).iter().all(|(t, _)| *t != TAG_INST));
        let read = Scene::from_rsb(&plain).unwrap();
        assert!(read.geometry.has_implicit_instances());
        assert_eq!(read.geometry.instances().len(), 2);
    }

    #[test]
    fn instances_must_refer_to_existing_meshes_and_materials() {
        let good = instanced_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                if tag == TAG_INST {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        let bad_mesh = rebuild(&|p| p[0..4].copy_from_slice(&7u32.to_le_bytes()));
        assert_eq!(
            Scene::from_rsb(&bad_mesh),
            Err(RsbError::Invalid {
                tag: TAG_INST,
                reason: "mesh_id does not refer to a MESH section"
            })
        );
        let bad_material = rebuild(&|p| p[52..56].copy_from_slice(&9u32.to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&bad_material),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        let nan = rebuild(&|p| p[8..12].copy_from_slice(&f32::NAN.to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&nan),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        let short = rebuild(&|p| p.truncate(40));
        assert_eq!(
            Scene::from_rsb(&short),
            Err(RsbError::SectionTooShort { tag: TAG_INST })
        );
    }

    /// `bytes` without its `MESH` sections.
    fn without_meshes(bytes: &[u8]) -> Vec<u8> {
        let mut out = bytes[..8].to_vec();
        for (tag, payload) in sections(bytes) {
            if tag != TAG_MESH {
                out.extend(unknown_section(&tag, &payload));
            }
        }
        out
    }

    #[test]
    fn updates_without_meshes_keep_the_loaded_meshes() {
        let mut scene = instanced_scene();
        // The next state: another camera and image size, one more material, other instances.
        let mut next = instanced_scene();
        next.camera.focal_mm = 35.0;
        next.render.width = 320;
        next.render.height = 180;
        next.materials.push(Material {
            roughness: 0.9,
            ..Material::default()
        });
        let instances = vec![
            Instance::new(1, Transform::translation(Vec3::new(0.0, 0.0, 7.0)), 2),
            Instance::new(0, Transform::IDENTITY, 0),
        ];
        next.geometry = Geometry::new(next.geometry.meshes().to_vec(), instances).unwrap();
        let update = without_meshes(&next.to_rsb());
        assert!(sections(&update).iter().all(|(t, _)| *t != TAG_MESH));
        assert!(Scene::from_rsb(&update).is_err(), "alone it lacks meshes");
        scene.update_from_rsb(&update).expect("update");
        assert_eq!(scene, next);

        // Without INST sections either: the implicit instances of the kept meshes.
        let plain = full_scene();
        scene
            .update_from_rsb(&without_meshes(&plain.to_rsb()))
            .expect("update");
        assert_eq!(scene, plain);
        assert!(scene.geometry.has_implicit_instances());

        // A file with meshes replaces everything, like from_rsb.
        let mut other = full_scene();
        other.geometry = Geometry::from_meshes(vec![Mesh::new(
            &[
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            &[],
            &[0, 1, 2],
            0,
        )
        .unwrap()]);
        scene.update_from_rsb(&other.to_rsb()).expect("full update");
        assert_eq!(scene, other);
    }

    #[test]
    fn failed_updates_leave_the_scene_unchanged() {
        let mut scene = instanced_scene();
        let before = scene.clone();
        let good = without_meshes(&instanced_scene().to_rsb());
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        // An instance of a mesh the scene does not have.
        let bad_mesh = rebuild(&|tag, p| {
            if *tag == TAG_INST {
                p[0..4].copy_from_slice(&7u32.to_le_bytes());
            }
        });
        assert!(matches!(
            scene.update_from_rsb(&bad_mesh),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        assert_eq!(scene, before);
        // Fewer materials than the kept meshes refer to (the second mesh uses material 1).
        let mut one_material = good[..8].to_vec();
        let mut first = true;
        for (tag, payload) in sections(&good) {
            if tag == TAG_INST {
                continue;
            }
            if tag == TAG_MATL {
                if !first {
                    continue;
                }
                first = false;
            }
            one_material.extend(unknown_section(&tag, &payload));
        }
        assert!(matches!(
            scene.update_from_rsb(&one_material),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        assert_eq!(scene, before);
        // Garbage.
        assert_eq!(scene.update_from_rsb(b"nope"), Err(RsbError::BadMagic));
        assert_eq!(scene, before);
    }

    #[test]
    fn lying_mesh_counts_fail_without_allocating() {
        let mut file = b"RSB1\0\0\0\0".to_vec();
        let mut p = Vec::new();
        p.extend_from_slice(&u32::MAX.to_le_bytes());
        p.extend_from_slice(&u32::MAX.to_le_bytes());
        file.extend(unknown_section(&TAG_MESH, &p));
        assert_eq!(
            Scene::from_rsb(&file),
            Err(RsbError::SectionTooShort { tag: TAG_MESH })
        );
    }

    #[test]
    fn errors_display_readable_messages() {
        assert_eq!(
            RsbError::BadMagic.to_string(),
            "not an RSB file (missing RSB1 magic)"
        );
        assert_eq!(
            RsbError::Truncated { what: "header" }.to_string(),
            "RSB file is truncated in header"
        );
        assert_eq!(
            RsbError::SectionTooShort { tag: *b"CAMR" }.to_string(),
            "RSB section CAMR is shorter than its layout requires"
        );
        assert_eq!(
            RsbError::DuplicateSection { tag: *b"RNDR" }.to_string(),
            "RSB section RNDR appears more than once"
        );
        assert_eq!(
            RsbError::Invalid {
                tag: *b"MESH",
                reason: "vertex index out of range"
            }
            .to_string(),
            "RSB section MESH is invalid: vertex index out of range"
        );
        assert_eq!(
            RsbError::Invalid {
                tag: [0, b'A', 7, b'B'],
                reason: "x"
            }
            .to_string(),
            "RSB section ?A?B is invalid: x"
        );
    }

    impl Material {
        /// Serialised default material payload, for tests that hand-build files.
        fn to_bytes_for_test() -> Vec<u8> {
            let scene = Scene {
                materials: vec![Material::default()],
                ..Scene::default()
            };
            sections(&scene.to_rsb())
                .into_iter()
                .find(|(t, _)| *t == TAG_MATL)
                .unwrap()
                .1
        }
    }

    // --- IES lights (L5) ---------------------------------------------------------------------

    fn ies_profile(text: &str) -> Arc<IesProfile> {
        Arc::new(IesProfile::parse(text.as_bytes()).expect("a profile"))
    }

    fn ies_light(profile: &Arc<IesProfile>, x: f32) -> Light {
        Light {
            kind: LightKind::Ies,
            position: Vec3::new(x, -300.0, 500.0),
            direction: Vec3::new(0.0, 0.5, -1.0).normalize(),
            up: Vec3::new(0.0, 0.0, 1.0),
            size_x: 12.0,
            size_y: 12.0,
            color: Rgb::new(1.0, 0.8, 0.6),
            power: 7.5,
            spread_deg: 180.0,
            angle_deg: 0.0,
            flags: LIGHT_FLAG_GLOSSY,
            ies: Some(Arc::clone(profile)),
        }
    }

    /// `full_scene` with three IES lights: two on one profile, one on another.
    fn ies_scene() -> Scene {
        let mut scene = full_scene();
        let down = ies_profile(crate::ies::tests::DOWNLIGHT);
        let washer = ies_profile(crate::ies::tests::WALL_WASHER);
        scene.lights.push(ies_light(&down, -200.0));
        scene.lights.push(ies_light(&washer, 0.0));
        scene.lights.push(ies_light(&down, 200.0));
        scene
    }

    #[test]
    fn ies_lights_travel_with_their_profiles_once_each() {
        let scene = ies_scene();
        let bytes = scene.to_rsb();
        let parts = sections(&bytes);
        let profiles: Vec<&Vec<u8>> = parts
            .iter()
            .filter(|(t, _)| *t == TAG_IESP)
            .map(|(_, p)| p)
            .collect();
        // Two profiles for three lights, in the order of first use, after the lights.
        assert_eq!(profiles.len(), 2);
        let len = |p: &Vec<u8>| u32::from_le_bytes(p[..4].try_into().unwrap()) as usize;
        assert_eq!(
            &profiles[0][4..4 + len(profiles[0])],
            crate::ies::tests::DOWNLIGHT.as_bytes()
        );
        assert_eq!(profiles[0].len() % 4, 0);
        assert_eq!(
            &profiles[1][4..4 + len(profiles[1])],
            crate::ies::tests::WALL_WASHER.as_bytes()
        );
        let tags: Vec<[u8; 4]> = parts.iter().map(|(t, _)| *t).collect();
        let first_iesp = tags.iter().position(|t| *t == TAG_IESP).unwrap();
        assert_eq!(tags[first_iesp - 1], TAG_LGHT);
        // 76 bytes for the lights of before, 80 for an IES light (the profile's position).
        let lghts: Vec<usize> = parts
            .iter()
            .filter(|(t, _)| *t == TAG_LGHT)
            .map(|(_, p)| p.len())
            .collect();
        assert_eq!(lghts, [76, 76, 76, 76, 80, 80, 80]);
        let index = |light: usize| {
            let p = &parts
                .iter()
                .filter(|(t, _)| *t == TAG_LGHT)
                .nth(light)
                .unwrap()
                .1;
            u32::from_le_bytes(p[76..80].try_into().unwrap())
        };
        assert_eq!([index(4), index(5), index(6)], [0, 1, 0]);
        // Read back: the same scene, profile for profile.
        let read = Scene::from_rsb(&bytes).expect("reads back");
        assert_eq!(read, scene);
        assert!(Arc::ptr_eq(
            read.lights[4].ies.as_ref().unwrap(),
            read.lights[6].ies.as_ref().unwrap()
        ));
        assert_eq!(read.lights[5].ies.as_ref().unwrap().peak(), 900.0);
        // And written again: the very bytes.
        assert_eq!(read.to_rsb(), bytes);
    }

    #[test]
    fn a_scene_without_ies_lights_writes_the_bytes_it_always_did() {
        let bytes = full_scene().to_rsb();
        let parts = sections(&bytes);
        assert!(parts.iter().all(|(t, _)| *t != TAG_IESP));
        assert!(parts
            .iter()
            .filter(|(t, _)| *t == TAG_LGHT)
            .all(|(_, p)| p.len() == 76));
        // An IES light without a profile is no light for the engine and is not written.
        let mut scene = full_scene();
        scene.lights.push(Light {
            kind: LightKind::Ies,
            ..Light::default()
        });
        assert_eq!(scene.to_rsb(), bytes);
        // A profile on a light of another kind is nobody's: neither written nor counted in its record.
        let mut stray = full_scene();
        stray.lights[0].ies = Some(ies_profile(crate::ies::tests::DOWNLIGHT));
        assert_eq!(stray.to_rsb(), bytes);
    }

    #[test]
    fn a_profile_that_cannot_be_used_makes_the_file_invalid() {
        let good = ies_scene().to_rsb();
        // Rebuild the file with `edit` applied to the payloads of the sections `tag`.
        let rebuild = |tag: [u8; 4], edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (t, mut payload) in sections(&good) {
                if t == tag {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&t, &payload));
            }
            out
        };
        // A light that names a profile past the ones there are.
        assert_eq!(
            Scene::from_rsb(&rebuild(TAG_LGHT, &|p| {
                if p.len() == 80 {
                    p[76..80].copy_from_slice(&2u32.to_le_bytes());
                }
            })),
            Err(RsbError::Invalid {
                tag: TAG_LGHT,
                reason: "an IES light needs a profile that is an IESP section"
            })
        );
        // An IES light of 76 bytes (no profile word) and one that says none.
        assert!(matches!(
            Scene::from_rsb(&rebuild(TAG_LGHT, &|p| p.truncate(76))),
            Err(RsbError::Invalid { tag: TAG_LGHT, .. })
        ));
        assert!(matches!(
            Scene::from_rsb(&rebuild(TAG_LGHT, &|p| {
                if p.len() == 80 {
                    p[76..80].copy_from_slice(&u32::MAX.to_le_bytes());
                }
            })),
            Err(RsbError::Invalid { tag: TAG_LGHT, .. })
        ));
        // Profiles that are cut short, or are files the reader refuses, with the reason.
        assert_eq!(
            Scene::from_rsb(&rebuild(TAG_IESP, &|p| p.truncate(40))),
            Err(RsbError::SectionTooShort { tag: TAG_IESP })
        );
        let bad = |from: &str, to: &str| {
            let text = crate::ies::tests::DOWNLIGHT.replacen(from, to, 1);
            let mut payload = (text.len() as u32).to_le_bytes().to_vec();
            payload.extend_from_slice(text.as_bytes());
            payload.resize(payload.len().div_ceil(4) * 4, 0);
            Scene::from_rsb(&rebuild(TAG_IESP, &|p| *p = payload.clone()))
        };
        for (from, to, reason) in [
            ("TILT=NONE", "TILT=INCLUDE", IesError::TiltIncluded),
            ("1000 970", "1000 -970", IesError::NegativeCandela),
            (
                "1 2094 1 10 1 1 2",
                "1 2094 1 10 1 2 2",
                IesError::UnsupportedType(2),
            ),
            ("0 10 20", "0 20 10", IesError::BadVerticalAngles),
        ] {
            assert_eq!(
                bad(from, to),
                Err(RsbError::Invalid {
                    tag: TAG_IESP,
                    reason: reason.reason()
                }),
                "{from}"
            );
        }
        // The engine of before L5 skips the section and refuses the light kind: that one is the
        // reader's `unknown light kind`, tested above. This one reads a file with a profile no
        // light uses without complaint.
        let mut spare = full_scene().to_rsb();
        let text = crate::ies::tests::DOWNLIGHT;
        let mut payload = (text.len() as u32).to_le_bytes().to_vec();
        payload.extend_from_slice(text.as_bytes());
        payload.resize(payload.len().div_ceil(4) * 4, 0);
        spare.extend(unknown_section(&TAG_IESP, &payload));
        assert_eq!(Scene::from_rsb(&spare), Ok(full_scene()));
    }

    #[test]
    fn an_update_replaces_the_profiles_with_the_lights() {
        // The lights and their profiles are always sent whole: an update that has none of either
        // leaves a scene without IES lights, and one that has them brings them.
        let mut scene = full_scene();
        scene
            .update_from_rsb(&ies_scene().to_rsb())
            .expect("update");
        assert_eq!(scene.lights.iter().filter(|l| l.ies.is_some()).count(), 3);
        scene
            .update_from_rsb(&full_scene().to_rsb())
            .expect("update");
        assert!(scene.lights.iter().all(|l| l.ies.is_none()));
        assert_eq!(scene.lights.len(), 4);
    }
}
