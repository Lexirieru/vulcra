module github.com/vulcra/tee-extension

go 1.25

// NOTE: This module deliberately has NO external `require` entries.
//
// The pure decision packages that MUST build and test OFFLINE
//   - internal/keeper   (liquidation decision logic)
//   - internal/guardian (private protection-rule store + evaluation + keccak256)
//   - internal/config   (OP identifiers + env wiring, stdlib only)
//   - pkg/types         (request/response DTOs, stdlib encoding/json only)
// import ONLY the Go standard library, so:
//
//   GOPROXY=off go test ./internal/keeper/... ./internal/guardian/...
//
// runs with no network and no module downloads.
//
// The framework wiring in `internal/extension` and `cmd/extension` imports the
// fce-extension-scaffold packages (teetypes / instruction / teeutils). Those
// require lines are intentionally omitted here and must be added by the
// orchestrator once the scaffold is vendored, e.g.:
//
//   require github.com/flare-foundation/fce-extension-scaffold vX.Y.Z
//
// Until then those two packages will NOT compile offline — which is expected
// and does not affect the pure packages above.
