module github.com/vulcra/tee-extension

go 1.25.1

// Dependency policy:
//
// The pure decision packages MUST keep building and testing OFFLINE with zero
// module downloads:
//   - internal/keeper   (liquidation decision logic)
//   - internal/guardian (private protection-rule store + evaluation + keccak256)
//   - internal/config   (OP identifiers + env wiring, stdlib only)
//   - pkg/types         (request/response DTOs, stdlib encoding/json only)
// They import ONLY the Go standard library, so
//   GOPROXY=off go test ./internal/keeper/... ./internal/guardian/...
// still runs with no network.
//
// The framework wiring (internal/extension, internal/chain, cmd/extension,
// tools/) uses the SAME framework modules as fce-extension-scaffold:
// go-flare-common (instruction encoding), tee-node (Action types, ToHash,
// /decrypt wire types, extension server bootstrap) and go-ethereum (eth client
// + ABI for the authoritative in-enclave chain reads).
//
// tee-node PIN POLICY — keep it current, this is not cosmetic.
// Pinned to develop c687a8631bca239a6188fccc3469f3a676aa48eb (2026-07-22), the
// first commit after Flare redeployed FCC on Coston2. It changes the
// data-provider weight check in pkg/processorutils/thresholds.go
// (`weight <= dpThreshold` -> `dpThreshold > 0 && weight <= dpThreshold`, and
// drops the Wallet/KeyDataProviderRestore zero-threshold case). An older node
// rejects the votes the current data providers cast, so register-tee's
// availability check never accrues weight and the machine never reaches
// PRODUCTION. go-flare-common stays at the exact version tee-node requires.
// See docs/fcc-production-registration.md.

require (
	github.com/ethereum/go-ethereum v1.17.2
	github.com/flare-foundation/go-flare-common v1.2.2-0.20260623111601-c573c79c0924
	github.com/flare-foundation/tee-node v0.0.23-0.20260722073401-c687a8631bca
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/ProjectZKM/Ziren/crates/go-runtime/zkvm_runtime v0.0.0-20251106012722-c7be33e82a11 // indirect
	github.com/bits-and-blooms/bitset v1.24.3 // indirect
	github.com/btcsuite/btcd/btcec/v2 v2.3.4 // indirect
	github.com/cenkalti/backoff/v4 v4.3.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/consensys/gnark-crypto v0.19.2 // indirect
	github.com/crate-crypto/go-eth-kzg v1.5.0 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/deckarep/golang-set/v2 v2.8.0 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0 // indirect
	github.com/ethereum/c-kzg-4844/v2 v2.1.6 // indirect
	github.com/fsnotify/fsnotify v1.9.0 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/go-sql-driver/mysql v1.9.3 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/holiman/uint256 v1.3.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/shirou/gopsutil v3.21.11+incompatible // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	github.com/supranational/blst v0.3.16 // indirect
	github.com/tklauser/go-sysconf v0.3.15 // indirect
	github.com/tklauser/numcpus v0.10.0 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/otel v1.40.0 // indirect
	go.opentelemetry.io/otel/metric v1.40.0 // indirect
	go.opentelemetry.io/otel/trace v1.40.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.50.0 // indirect
	golang.org/x/exp v0.0.0-20250911091902-df9299821621 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.36.0 // indirect
	gopkg.in/natefinch/lumberjack.v2 v2.2.1 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	gorm.io/driver/mysql v1.6.0 // indirect
	gorm.io/gorm v1.31.0 // indirect
)
