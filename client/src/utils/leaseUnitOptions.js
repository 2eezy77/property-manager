/**
 * Create-Lease unit picker rules.
 * Native VA room leases share a house unit — occupied rooms stay selectable.
 * Legacy whole-unit leases only list vacant units.
 */

export function filterUnitsForLeasePath(units, leasePath) {
  const allowOccupied = leasePath === 'native';
  return (units || []).filter((u) => allowOccupied || !u.is_occupied);
}
