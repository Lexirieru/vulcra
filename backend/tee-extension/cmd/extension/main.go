// Command extension is the entry point for the Vulcra TEE extension HTTP server.
//
// ============================ OFFLINE-BUILD NOTE ============================
// This main imports internal/extension, which imports the fce-extension-scaffold
// framework. It therefore DOES NOT build offline (expected). It is the
// reproducible-build target (scripts/reproducible-build.sh) once the scaffold is
// vendored. The pure decision packages build and test offline independently.
// ===========================================================================
package main

import (
	"log"

	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/extension"
	// SCAFFOLD: the scaffold's HTTP server bootstrap. Confirm the exact package
	// and API (it wires POST /action to the extension's processAction, and
	// starts the types-server sidecar). Something like:
	//   "github.com/flare-foundation/fce-extension-scaffold/pkg/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ext := extension.New(cfg)
	_ = ext // SCAFFOLD: server.Run(ext.processAction) — start POST /action + types server.

	log.Printf("vulcra tee-extension %s: simulatedTEE=%v rpc=%s",
		config.Version, cfg.SimulatedTEE, cfg.RPCURL)
	log.Fatal("SCAFFOLD: wire the fce-extension-scaffold HTTP server here (POST /action -> ext.processAction)")
}
