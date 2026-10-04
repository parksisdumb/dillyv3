/**
 * Digits-only phone matching for search: "(512) 555-0134", "512.555.0134", "+1 512 555 0134" and "5125550134"
 * all find the same contact. Matches against contact.phone_digits (digits of phone + mobile, generated column
 * from 20261004100500_push_subscription_and_phone_search.sql).
 */

/** The digits to look for, or null when the term isn't phone-like (fewer than 4 digits, or mostly letters). */
export function phoneSearchDigits(term: string | null | undefined): string | null {
  const t = (term ?? "").trim();
  if (!t || /[a-z]/i.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.length < 4) return null;
  // US country code: "+1 512 555 0134" should find "(512) 555-0134".
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/** Extra PostgREST `or` clause for a phone-like term ("" when not phone-like). Prepend with a comma. */
export function phoneDigitsClause(term: string | null | undefined): string {
  const d = phoneSearchDigits(term);
  return d ? `,phone_digits.ilike.%${d}%` : "";
}
