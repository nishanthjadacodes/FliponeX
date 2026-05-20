// Short employee-style ID shown to reps so they can quickly identify
// themselves over the phone with admin or customers. Derived from the
// user UUID — no DB column, no migration, deterministic per rep.
//
//   repCode({ id: '1f8fe081-5cb3-4a7d-...' }) → 'FLIPRT11542'
//
// Format: "FLIPRT" + 5 digits. The digit block is a stable hash of the
// user UUID, mapped into the [10000, 99999] range so it's always
// exactly 5 digits (never a leading zero, never collapses to 4).
// The SAME derivation lives in
// admindashboard1/admindashboard/components/AgentManagement.tsx
// so the rep app and Admin > Representative Management show the
// identical code for any given rep. If you change the formula here,
// change it there too.
//
// If admin ever explicitly assigns an `agent_code` to a rep (manual
// override), we surface that string verbatim instead.

interface CodeBearer {
  id?: string | number;
  agent_code?: string | null;
}

// FNV-1a hash so the digit block is stable across sessions and devices
// (no Math.random — that would shuffle the code on every render).
const hashToFiveDigits = (input: string): string => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Force into [10000, 99999] so output is always 5 digits.
  const n = (Math.abs(h | 0) % 90000) + 10000;
  return String(n);
};

export const repCode = (user: CodeBearer | null | undefined): string => {
  if (!user) return 'FLIPRT00000';
  if (user.agent_code && String(user.agent_code).trim()) {
    return String(user.agent_code).trim();
  }
  const seed = String(user.id || '');
  if (!seed) return 'FLIPRT00000';
  return `FLIPRT${hashToFiveDigits(seed)}`;
};
