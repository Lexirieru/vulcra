package types

// register.go describes the decoder registrations for the FCC "types server"
// sidecar (POST /decode, GET /registry) that turns raw hex instruction data
// into human-readable JSON for the frontend and debugging.
//
// The scaffold's registration API (teetypes.NewJSONDecoder / NewABIDecoder and
// a global registry) is a framework dependency that is not available offline,
// so this file does NOT import it. Instead it declares, in a stdlib-only form,
// exactly which (OPType, OPCommand, Kind) entries must be registered and which
// Go struct each maps to. internal/extension (or a small registration shim)
// wires these into the scaffold at build time.
//
// SCAFFOLD: in fce-extension-scaffold this maps to pkg/types/register.go, e.g.
//
//	func Register(r *teetypes.Registry) {
//	    r.Add(config.OPTypeKeeper,   config.OPCommandScan,     teetypes.KindMessage, teetypes.NewJSONDecoder(func() any { return &KeeperScanRequest{} }))
//	    r.Add(config.OPTypeKeeper,   config.OPCommandScan,     teetypes.KindResult,  teetypes.NewJSONDecoder(func() any { return &KeeperScanResult{} }))
//	    r.Add(config.OPTypeGuardian, config.OPCommandRegister, teetypes.KindMessage, teetypes.NewJSONDecoder(func() any { return &GuardianRegisterRequest{} }))
//	    r.Add(config.OPTypeGuardian, config.OPCommandRegister, teetypes.KindResult,  teetypes.NewJSONDecoder(func() any { return &GuardianRegisterResult{} }))
//	    r.Add(config.OPTypeGuardian, config.OPCommandEvaluate, teetypes.KindMessage, teetypes.NewJSONDecoder(func() any { return &GuardianEvaluateRequest{} }))
//	    r.Add(config.OPTypeGuardian, config.OPCommandEvaluate, teetypes.KindResult,  teetypes.NewJSONDecoder(func() any { return &GuardianEvaluateResult{} }))
//	}

// Kind distinguishes a request payload from a result payload for a given op.
type Kind string

const (
	KindMessage Kind = "message" // instruction request payload
	KindResult  Kind = "result"  // extension result payload
)

// Registration is one (OPType, OPCommand, Kind) -> Go type binding. NewValue
// returns a fresh pointer to decode JSON into, mirroring the scaffold's
// NewJSONDecoder factory shape.
type Registration struct {
	OPType    string
	OPCommand string
	Kind      Kind
	NewValue  func() any
}

// Registrations is the full set of decoder bindings for this extension. The
// OPType/OPCommand strings intentionally match internal/config exactly; they
// are duplicated as literals here only to keep pkg/types free of an import
// cycle with internal/config.
var Registrations = []Registration{
	{"KEEPER", "SCAN", KindMessage, func() any { return &KeeperScanRequest{} }},
	{"KEEPER", "SCAN", KindResult, func() any { return &KeeperScanResult{} }},
	{"GUARDIAN", "REGISTER", KindMessage, func() any { return &GuardianRegisterRequest{} }},
	{"GUARDIAN", "REGISTER", KindResult, func() any { return &GuardianRegisterResult{} }},
	{"GUARDIAN", "EVALUATE", KindMessage, func() any { return &GuardianEvaluateRequest{} }},
	{"GUARDIAN", "EVALUATE", KindResult, func() any { return &GuardianEvaluateResult{} }},
}
