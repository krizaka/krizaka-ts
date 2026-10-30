// Code-point order for strings (what Array#sort does by default, said explicitly so the order is deterministic by contract).
export const asc = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};
