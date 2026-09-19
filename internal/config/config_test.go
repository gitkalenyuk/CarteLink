package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHome_PortableMode(t *testing.T) {
	// Test CARTELGATE_HOME override
	orig := os.Getenv("CARTELGATE_HOME")
	defer os.Setenv("CARTELGATE_HOME", orig)

	tempDir := t.TempDir()
	os.Setenv("CARTELGATE_HOME", tempDir)
	if got := Home(); got != tempDir {
		t.Errorf("Home() with CARTELGATE_HOME = %q, want %q", got, tempDir)
	}

	// Test default or portable
	os.Unsetenv("CARTELGATE_HOME")
	gotDefault := Home()
	if gotDefault == "" {
		t.Errorf("Home() returned empty string")
	}

	exePath, err := os.Executable()
	if err == nil {
		exeDir := filepath.Dir(exePath)
		markerPath := filepath.Join(exeDir, ".portable")
		// If marker exists, Home() should return exeDir
		_ = os.WriteFile(markerPath, []byte(""), 0o644)
		if got := Home(); got != exeDir {
			t.Errorf("Home() with .portable = %q, want %q", got, exeDir)
		}
		_ = os.Remove(markerPath)
	}
}
