//go:build ignore

// makeicon renders the CarteLink app icon (256×256 PNG): a rounded tile
// with the crimson→amber brand gradient and a white gate mark (arch + two
// posts + base), matching the SVG logo in the UI sidebar.
//
//	go run build/makeicon.go && node build/makeico.js && rsrc -ico build/icon.ico -o rsrc_windows_amd64.syso
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

const size = 256

func main() {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	radius := 56.0
	// Supersample 3×3 for smooth edges.
	const ss = 3
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					px := float64(x) + (float64(sx)+0.5)/ss
					py := float64(y) + (float64(sy)+0.5)/ss
					cr, cg, cb, ca := sample(px, py, radius)
					r += cr
					g += cg
					b += cb
					a += ca
				}
			}
			n := float64(ss * ss)
			img.SetNRGBA(x, y, color.NRGBA{uint8(r / n), uint8(g / n), uint8(b / n), uint8(a / n)})
		}
	}
	f, err := os.Create("build/icon256.png")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}

// sample returns the colour at a sub-pixel position.
func sample(px, py, radius float64) (r, g, b, a float64) {
	if !inRoundedRect(px, py, 8, 8, size-8, size-8, radius) {
		return 0, 0, 0, 0
	}
	// Brand gradient along the diagonal: #e63946 → #ff6a3d → #ffb347.
	t := (px + py) / (2 * size)
	r, g, b = grad(t)
	// Subtle top highlight.
	if py < size*0.45 {
		k := (size*0.45 - py) / (size * 0.45) * 0.10
		r += (255 - r) * k
		g += (255 - g) * k
		b += (255 - b) * k
	}
	if inGate(px, py) {
		return 255, 255, 255, 255
	}
	return r, g, b, 255
}

func grad(t float64) (float64, float64, float64) {
	c0 := [3]float64{0xe6, 0x39, 0x46}
	c1 := [3]float64{0xff, 0x6a, 0x3d}
	c2 := [3]float64{0xff, 0xb3, 0x47}
	var a, c [3]float64
	var k float64
	if t < 0.55 {
		a, c, k = c0, c1, t/0.55
	} else {
		a, c, k = c1, c2, (t-0.55)/0.45
	}
	return a[0] + (c[0]-a[0])*k, a[1] + (c[1]-a[1])*k, a[2] + (c[2]-a[2])*k
}

func inRoundedRect(px, py, x0, y0, x1, y1, r float64) bool {
	if px < x0 || px > x1 || py < y0 || py > y1 {
		return false
	}
	cx := math.Max(x0+r, math.Min(px, x1-r))
	cy := math.Max(y0+r, math.Min(py, y1-r))
	dx, dy := px-cx, py-cy
	return dx*dx+dy*dy <= r*r
}

// inGate draws the mark in a 32×32 design grid scaled to the tile:
// arch from (6,26) up over centre (16,12) r=10, posts at x=12 and x=20 from
// y=15 to 26, base line y=26 from x=3 to 29. Stroke width ≈3.2 units.
func inGate(px, py float64) bool {
	scale := size / 32.0
	x, y := px/scale, py/scale
	w := 1.7 // half stroke width
	// Base line.
	if y >= 26-w && y <= 26+w && x >= 3-w && x <= 29+w {
		return roundCap(x, y, 3, 26, w) || roundCap(x, y, 29, 26, w) || (x >= 3 && x <= 29)
	}
	// Posts.
	for _, cx := range []float64{12, 20} {
		if x >= cx-w && x <= cx+w && y >= 15-w && y <= 26 {
			if y < 15 {
				return roundCap(x, y, cx, 15, w)
			}
			return true
		}
	}
	// Arch sides (vertical part below the semicircle centre).
	for _, cx := range []float64{6, 26} {
		if x >= cx-w && x <= cx+w && y >= 12 && y <= 26 {
			return true
		}
	}
	// Semicircle centred (16,12) radius 10, upper half only.
	dx, dy := x-16, y-12
	d := math.Hypot(dx, dy)
	if dy <= 0 && d >= 10-w && d <= 10+w {
		return true
	}
	return false
}

func roundCap(x, y, cx, cy, w float64) bool {
	return math.Hypot(x-cx, y-cy) <= w
}
