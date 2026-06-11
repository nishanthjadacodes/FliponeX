// Input sanitizers for the booking / details forms.
//
// Applied at the TextInput's onChangeText so the WRONG character type
// can never even be typed — better UX than rejecting on submit. Each
// returns the cleaned string.
//
// Examples:
//   lettersOnly('Ravi123')      → 'Ravi'
//   lettersOnly('Sai Kumar')    → 'Sai Kumar'   (spaces kept)
//   alphaNumeric('12-A, MG Rd') → '12-A, MG Rd' (letters+digits+addr punct)
//   digitsOnly('98a76')         → '9876'

// Letters + spaces only. For names, town/village, taluka/tehsil/mandal.
// Also collapses a leading space so a field can't start with whitespace.
// Apostrophe, dot and hyphen are allowed — real names use them
// ("D'Souza", "St. Mary", "Anne-Marie").
export const lettersOnly = (value: string): string =>
  (value || '')
    .replace(/[^a-zA-Z\s.'-]/g, '')
    .replace(/^\s+/, '');

// Letters + digits + spaces + common address punctuation. For
// street / area / locality where "12-A, 2nd Cross" is valid.
export const alphaNumeric = (value: string): string =>
  (value || '')
    .replace(/[^a-zA-Z0-9\s,./#&()-]/g, '')
    .replace(/^\s+/, '');

// Digits only. For mobile, pincode, Aadhaar number, etc.
export const digitsOnly = (value: string): string =>
  (value || '').replace(/[^0-9]/g, '');

// Submit-time guard: true when the value is a usable name — has at
// least one letter and is NOT all digits / all punctuation. Use this
// to block "1234" style junk that slipped through.
export const isValidName = (value: string): boolean => {
  const v = (value || '').trim();
  return v.length >= 2 && /[a-zA-Z]/.test(v);
};
