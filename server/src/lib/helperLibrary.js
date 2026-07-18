// Small, hand-verified OpenSCAD helper modules prepended to every render.
// These exist because raw CSG (cube/sphere/cylinder + booleans) forces the
// model to hand-derive fillets, rounding and sweeps from scratch every time,
// which is exactly where subtle transform mistakes (e.g. a handle placed
// tangent to a wall instead of overlapping it) creep in. Keeping this list
// short and each module individually simple means each one is easy to trust.
export const HELPER_LIBRARY_SCAD = `
// ---- text2scad helper library (auto-included, no import needed) ----

// A box with rounded vertical+horizontal edges (hull of 8 corner spheres).
module rounded_box(size, r = 2) {
    x = size[0]; y = size[1]; z = size[2];
    hull() {
        for (dx = [r, x - r])
            for (dy = [r, y - r])
                for (dz = [r, z - r])
                    translate([dx, dy, dz]) sphere(r);
    }
}

// A straight rounded rod/pill between two points (hull of 2 spheres).
module capsule(p1, p2, r) {
    hull() {
        translate(p1) sphere(r);
        translate(p2) sphere(r);
    }
}

// A hollow cylinder (pipe) — avoids re-deriving the difference() by hand.
module tube(h, r_outer, r_inner, center = false) {
    difference() {
        cylinder(h = h, r = r_outer, center = center);
        translate([0, 0, center ? 0 : -0.5])
            cylinder(h = h + (center ? 1 : 1), r = r_inner, center = center);
    }
}

// A flat tube arc lying in the XY plane: endpoints at angle 0 and angle
// 'ang', both at z=0, radius 'r_major' from the Z axis, tube radius
// 'r_minor'. Useful as a handle/loop shape before rotating into place —
// remember any protrusion attached to a wall must OVERLAP it, not just
// touch it (see the system prompt's overlap rule).
module torus_arc(r_major, r_minor, ang = 180) {
    rotate_extrude(angle = ang)
        translate([r_major, 0])
            circle(r = r_minor);
}
`.trim();
