package guardian

import "math/big"

// ShouldRepay decides whether the Guardian should perform a protective repay
// for a vault, and for how much (vUSD, 18 decimals).
//
// It returns (true, amount) ONLY when the vault sits inside the protection
// window:
//
//	mcrBps < currentCRBps < rule.TriggerCRBps
//
// i.e. the vault has dropped below the user's PRIVATE trigger but is still
// above MCR. At or above the trigger there is nothing to do; at or below MCR
// the liquidation keeper owns the vault (the Guardian steps aside so it does
// not race the keeper). See eval_test.go for the AE3 scenarios.
//
// # Amount
//
//	amount = min(rule.MaxRepay18, neededToRestore)
//
// where neededToRestore is the debt reduction that lifts CR from currentCRBps
// back up to the trigger. Repaying debt raises CR (collateral value is
// unchanged), so with current debt D:
//
//	neededToRestore = D * (trigger - currentCR) / trigger
//
// derived from CR = collateralValue*10000/debt: to move CR from currentCR to
// trigger, debt must fall to currentCR*D/trigger, a reduction of
// D*(trigger-currentCR)/trigger.
//
// # Signature note
//
// The task sketch is ShouldRepay(rule, currentCRBps, mcrBps). This function
// additionally takes currentDebt18 because the ABSOLUTE repay amount (18-dec
// vUSD, the delegatedRepay maxAmount) cannot be derived from collateral RATIOS
// alone — it needs the current debt. The boolean decision still depends only on
// the three ratios. All math uses big.Int to avoid overflow.
func ShouldRepay(rule *Rule, currentCRBps, mcrBps, currentDebt18 *big.Int) (bool, *big.Int) {
	zero := big.NewInt(0)

	if rule == nil || rule.TriggerCRBps == nil || rule.MaxRepay18 == nil {
		return false, zero
	}
	if currentCRBps == nil || mcrBps == nil || currentDebt18 == nil {
		return false, zero
	}
	if currentDebt18.Sign() <= 0 {
		return false, zero // no debt to repay
	}

	// At or below MCR: keeper territory — the Guardian does not act.
	if currentCRBps.Cmp(mcrBps) <= 0 {
		return false, zero
	}
	// At or above the private trigger: vault is healthy — nothing to do.
	if currentCRBps.Cmp(rule.TriggerCRBps) >= 0 {
		return false, zero
	}

	// Protection window: mcr < currentCR < trigger.
	// neededToRestore = debt * (trigger - currentCR) / trigger
	diff := new(big.Int).Sub(rule.TriggerCRBps, currentCRBps) // > 0 here
	needed := new(big.Int).Mul(currentDebt18, diff)
	needed.Quo(needed, rule.TriggerCRBps)

	// amount = min(MaxRepay18, neededToRestore)
	amount := needed
	if amount.Cmp(rule.MaxRepay18) > 0 {
		amount = new(big.Int).Set(rule.MaxRepay18)
	}
	if amount.Sign() <= 0 {
		// Rounded down to zero (currentCR essentially at trigger) — no-op.
		return false, zero
	}
	return true, amount
}
