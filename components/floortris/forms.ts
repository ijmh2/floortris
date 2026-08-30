/** Per-variant visual treatment. Purely cosmetic: a form never reaches the
 *  engine, the Kind union or a tool schema. It only lets two pieces of the same
 *  kind — a bookshelf and a laundry basket, say — pick different 2D and 3D
 *  treatments. A variant with no form keeps the kind's own shape, which is also
 *  what every owned or measured piece uses, so forms can never regress those. */
export type Form =
  | 'shelving' | 'drawers' | 'bedside' | 'basket' | 'media' | 'wardrobe' | 'chest' | 'vanity'
  | 'task' | 'armchair' | 'stool' | 'dining'
  | 'console' | 'side' | 'meeting' | 'bench'
  | 'standing' | 'corner' | 'dressing'
  | 'loveseat' | 'ottoman' | 'day';
/** How many plain <i> the 2D shape puts inside .ft-form-parts. 0 keeps the
 *  kind's own children and only adds .ft-form-* for the stylesheet to lean on. */
export const FORM_PARTS: Record<Form, number> = {
  shelving: 4, drawers: 3, bedside: 2, basket: 2, media: 3, wardrobe: 2, chest: 2, vanity: 2,
  task: 3, armchair: 4, stool: 1, dining: 2,
  console: 2, side: 1, meeting: 2, bench: 3,
  standing: 2, corner: 4, dressing: 2,
  loveseat: 0, ottoman: 1, day: 0,
};

/** Board label for a formed piece. Short: the 2D label renders at 5-11px, and
 *  every storage variant reading "STORAGE" defeats the point of the forms. */
export const FORM_LABEL: Record<Form, string> = {
  shelving: 'SHELVES', drawers: 'DRAWERS', bedside: 'BEDSIDE', basket: 'BASKET', media: 'MEDIA', wardrobe: 'WARDROBE', chest: 'CHEST', vanity: 'VANITY',
  task: 'TASK', armchair: 'ARMCHAIR', stool: 'STOOL', dining: 'CHAIR',
  console: 'CONSOLE', side: 'SIDE', meeting: 'MEETING', bench: 'BENCH',
  standing: 'STANDING', corner: 'CORNER', dressing: 'DRESSING',
  loveseat: 'LOVESEAT', ottoman: 'OTTOMAN', day: 'DAY BED',
};
