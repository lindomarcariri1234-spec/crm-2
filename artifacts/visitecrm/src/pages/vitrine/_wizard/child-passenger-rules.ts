export type CoPassenger = {
  name: string;
  cpf: string;
  phone: string;
  isChildUnder7: boolean;
  occupiesSeat: boolean;
};

export function getSeatedChildCount(children: readonly CoPassenger[]): number {
  return children.filter((child) => child.occupiesSeat).length;
}

export function getLapChildCount(children: readonly CoPassenger[]): number {
  return children.filter((child) => child.isChildUnder7 && !child.occupiesSeat).length;
}

export function getPaidSeatQuantity(children: readonly CoPassenger[]): number {
  // The customer is the primary passenger and always occupies a paid seat.
  return 1 + getSeatedChildCount(children);
}

export function hasCompleteChildPassengerData(children: readonly CoPassenger[]): boolean {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child || !child.name.trim()) return false;
    if (!child.isChildUnder7 && !child.occupiesSeat) return false;
  }
  return true;
}
