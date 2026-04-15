export function applySpotOverrides(args: {
  autoSelected: string[];
  forcedIn: string[];
  forcedOut: string[];
}) {
  const selected = new Set(args.autoSelected);
  const forcedOutSet = new Set(args.forcedOut);

  forcedOutSet.forEach((id) => {
    selected.delete(id);
  });

  args.forcedIn.forEach((id) => {
    selected.add(id);
  });

  return Array.from(selected);
}

export function applySingleOverride(args: {
  spotId: string;
  mode: 'add' | 'remove';
  forcedIn: string[];
  forcedOut: string[];
}) {
  const forcedIn = new Set(args.forcedIn);
  const forcedOut = new Set(args.forcedOut);

  if (args.mode === 'add') {
    forcedOut.delete(args.spotId);
    forcedIn.add(args.spotId);
  } else {
    forcedIn.delete(args.spotId);
    forcedOut.add(args.spotId);
  }

  return {
    forcedIn: Array.from(forcedIn),
    forcedOut: Array.from(forcedOut),
  };
}

export function applyBulkOverride(args: {
  spotIds: string[];
  mode: 'add' | 'remove';
  forcedIn: string[];
  forcedOut: string[];
}) {
  let currentForcedIn = args.forcedIn;
  let currentForcedOut = args.forcedOut;

  for (const spotId of args.spotIds) {
    const next = applySingleOverride({
      spotId,
      mode: args.mode,
      forcedIn: currentForcedIn,
      forcedOut: currentForcedOut,
    });
    currentForcedIn = next.forcedIn;
    currentForcedOut = next.forcedOut;
  }

  return {
    forcedIn: currentForcedIn,
    forcedOut: currentForcedOut,
  };
}
