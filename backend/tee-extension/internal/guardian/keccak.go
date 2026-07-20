package guardian

// keccak.go — a small, self-contained Keccak-256 implementation (Ethereum's
// pre-NIST padding variant, domain suffix 0x01), using ONLY the Go standard
// library so the guardian package stays dependency-free and its tests run
// offline.
//
// WHY NOT crypto/sha256 OR crypto/sha3?
//
//   - crypto/sha256 would produce a DIFFERENT digest than the on-chain
//     keccak256(...) used to build the termsCommitment, so the enclave key and
//     the Solidity commitment would never line up.
//   - crypto/sha3 (Go stdlib) implements the NIST SHA3 padding (0x06), which is
//     NOT the same as Ethereum's Keccak-256 (0x01 padding). It cannot be used
//     as a drop-in for on-chain keccak256.
//
// So we implement Keccak-256 directly. It is byte-for-byte compatible with
// Ethereum's keccak256 (see keccak_test.go: it reproduces the standard
// keccak256("") and keccak256("abc") vectors). The production extension MAY
// swap this for go-ethereum's golang.org/x/crypto/sha3.NewLegacyKeccak256 — the
// output is identical — but this keeps the offline unit tests free of external
// modules.
//
// Reference: Keccak-f[1600] permutation, 24 rounds, rate = 1088 bits
// (136 bytes) for the 256-bit digest.

import (
	"encoding/binary"
	"math/bits"
)

// Round constants for the iota step (24 rounds).
var keccakRC = [24]uint64{
	0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
	0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
	0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
	0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
	0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
	0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
}

// Rotation offsets for the rho step, indexed as keccakRot[x][y] with the lane
// at (x, y) stored in state[x+5*y].
var keccakRot = [5][5]uint{
	{0, 36, 3, 41, 18},
	{1, 44, 10, 45, 2},
	{62, 6, 43, 15, 61},
	{28, 55, 25, 21, 56},
	{27, 20, 39, 8, 14},
}

// keccakF1600 applies the Keccak-f[1600] permutation in place.
func keccakF1600(a *[25]uint64) {
	var b [25]uint64
	var c [5]uint64
	var d [5]uint64

	for round := 0; round < 24; round++ {
		// Theta.
		for x := 0; x < 5; x++ {
			c[x] = a[x] ^ a[x+5] ^ a[x+10] ^ a[x+15] ^ a[x+20]
		}
		for x := 0; x < 5; x++ {
			d[x] = c[(x+4)%5] ^ bits.RotateLeft64(c[(x+1)%5], 1)
		}
		for x := 0; x < 5; x++ {
			for y := 0; y < 5; y++ {
				a[x+5*y] ^= d[x]
			}
		}
		// Rho + Pi: B[y][(2x+3y)%5] = rot(A[x][y], r[x][y]).
		for x := 0; x < 5; x++ {
			for y := 0; y < 5; y++ {
				b[y+5*((2*x+3*y)%5)] = bits.RotateLeft64(a[x+5*y], int(keccakRot[x][y]))
			}
		}
		// Chi.
		for x := 0; x < 5; x++ {
			for y := 0; y < 5; y++ {
				a[x+5*y] = b[x+5*y] ^ ((^b[(x+1)%5+5*y]) & b[(x+2)%5+5*y])
			}
		}
		// Iota.
		a[0] ^= keccakRC[round]
	}
}

// keccak256 returns the Keccak-256 digest of data (Ethereum semantics).
func keccak256(data []byte) [32]byte {
	const rate = 136 // bytes absorbed per permutation for a 256-bit digest

	var a [25]uint64

	// Absorb full rate-sized blocks.
	for len(data) >= rate {
		keccakXorIn(&a, data[:rate])
		keccakF1600(&a)
		data = data[rate:]
	}

	// Absorb the final (partial) block with pad10*1 and the 0x01 Keccak suffix.
	var block [rate]byte
	copy(block[:], data)
	block[len(data)] = 0x01 // domain-separation / start of padding
	block[rate-1] |= 0x80   // final padding bit
	keccakXorIn(&a, block[:])
	keccakF1600(&a)

	// Squeeze the first 32 bytes (little-endian lanes).
	var out [32]byte
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint64(out[i*8:], a[i])
	}
	return out
}

// keccakXorIn XORs a rate-aligned buffer into the state as little-endian lanes.
func keccakXorIn(a *[25]uint64, buf []byte) {
	for i := 0; i < len(buf)/8; i++ {
		a[i] ^= binary.LittleEndian.Uint64(buf[i*8:])
	}
}
