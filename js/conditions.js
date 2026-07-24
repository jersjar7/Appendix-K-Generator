const CONDITION_PATTERNS = {
  EX: /(^|[^a-z])EX(?=[^a-z]|$)|exist/i,
  NA: /(^|[^a-z])(?:NA|NAT)(?=[^a-z]|$)|natural/i,
  PR: /(^|[^a-z])PR(?=[^a-z]|$)|propos/i,
};

function conditionToken(text = "") {
  const matches = Object.entries(CONDITION_PATTERNS)
    .filter(([, pattern]) => pattern.test(String(text)))
    .map(([key]) => key);
  return matches.length === 1 ? matches[0] : null;
}

export function conditionKey(name = "", fileName = "") {
  return conditionToken(fileName) || conditionToken(name) || "DEFAULT";
}

export const CONDITION_ORDER = { EX: 0, NA: 1, PR: 2 };

export const conditionLabel = (key) =>
  ({ EX: "Existing", NA: "Natural", PR: "Proposed" }[key] || "Mesh");

export const conditionLabelFull = (key) =>
  ({ EX: "Existing Conditions", NA: "Natural Conditions", PR: "Proposed Conditions" }[key] || "Conditions");

export function runLabel(name) {
  return String(name)
    .replace(/\(SRH-2D\)/i, "")
    .replace(/^EX(?=[^a-z]|$)/i, "Existing")
    .replace(/^(?:NA|NAT)(?=[^a-z]|$)/i, "Natural")
    .replace(/^PR(?=[^a-z]|$)/i, "Proposed")
    .trim();
}

export function eventLabel(name) {
  return String(name)
    .replace(/\(SRH-2D\)/i, "")
    .replace(/^(?:EX|NA|NAT|PR)(?=[^a-z]|$)/i, "")
    .replace(/^(?:Existing|Natural|Proposed)(?=[^a-z]|$)/i, "")
    .replace(/^[_\s-]+/, "")
    .trim();
}
