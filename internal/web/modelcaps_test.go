package web

import "testing"

func TestMergeCaps(t *testing.T) {
	native := ModelCaps{Thinking: true, Levels: []string{"low", "max"}, ConfigUpdate: true, Context: 400000}
	checked := ModelCaps{Thinking: true, Levels: []string{"low", "max"}, Context: 200000}
	plain := ModelCaps{Context: 100000}

	cases := []struct {
		name        string
		prev, c     ModelCaps
		wantThink   bool
		wantUpdate  bool
		wantContext int
	}{
		{"both native", native, native, true, true, 400000},
		{"native then checked", native, checked, true, false, 200000},
		{"checked then native", checked, native, true, false, 200000},
		{"plain entry keeps native", native, plain, true, true, 100000},
		{"native replaces plain", plain, native, true, true, 100000},
	}
	for _, c := range cases {
		got := mergeCaps(c.prev, c.c)
		if got.Thinking != c.wantThink || got.ConfigUpdate != c.wantUpdate || got.Context != c.wantContext {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}
}
