export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from]?.includes(to) ?? false
}
