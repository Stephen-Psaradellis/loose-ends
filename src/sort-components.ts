import { createComponent, Types } from '@iwsdk/core';

/** A thought card; cardId keys into the Sort model. */
export const CardTag = createComponent('LooseEndsCard', {
  cardId: { type: Types.Int32, default: 0 },
});

/** One of the three trays; trayIndex keys into TRAYS. */
export const TrayTag = createComponent('LooseEndsTray', {
  trayIndex: { type: Types.Int32, default: 0 },
});

/** The mic orb: pinch, click or dwell on it to talk. */
export const MicTag = createComponent('LooseEndsMic', {});
