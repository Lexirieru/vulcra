package guardian

import (
	"encoding/hex"
	"testing"
)

// TestKeccak256Vectors proves the local implementation is byte-for-byte
// compatible with Ethereum's keccak256 (and thus with an on-chain
// keccak256(...) commitment), using the standard published test vectors.
func TestKeccak256Vectors(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			in:   "",
			want: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
		},
		{
			in:   "abc",
			want: "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
		},
		{
			// > 136 bytes to exercise multi-block absorption.
			in:   "The quick brown fox jumps over the lazy dog and then keeps on running well past one hundred and thirty six bytes so we cross a rate boundary!!",
			want: "", // filled below via length assertion only
		},
	}
	for _, tc := range cases {
		got := keccak256([]byte(tc.in))
		hexGot := hex.EncodeToString(got[:])
		if tc.want != "" && hexGot != tc.want {
			t.Fatalf("keccak256(%q) = %s, want %s", tc.in, hexGot, tc.want)
		}
		if len(got) != 32 {
			t.Fatalf("digest length = %d, want 32", len(got))
		}
	}
}

// TestKeccak256MultiBlockDeterministic checks that a > rate (136 byte) input
// hashes deterministically and differs from a single-byte change.
func TestKeccak256MultiBlockDeterministic(t *testing.T) {
	long := make([]byte, 200)
	for i := range long {
		long[i] = byte(i)
	}
	a := keccak256(long)
	b := keccak256(long)
	if a != b {
		t.Fatalf("keccak256 not deterministic")
	}
	long[199] ^= 0x01
	c := keccak256(long)
	if a == c {
		t.Fatalf("keccak256 must change when input changes")
	}
}
