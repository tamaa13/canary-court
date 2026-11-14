// A step's object in "How it works": rt-3d's 48-frame turntable for that step, scrubbed as the step crosses the screen
// (ScrubFigure), with its one-sentence caption right under the object (STEP_BOUNDS trims the frame's empty bands).

import { STEP_BOUNDS, STEP_CAPTIONS, stepFilm, stepPoster } from "@/content/how";
import { ScrubFigure } from "./ScrubFigure";

export function StepFigure({ step }: { step: number }) {
  return <ScrubFigure film={stepFilm(step)} poster={stepPoster(step)} bounds={STEP_BOUNDS[step - 1] ?? [0, 1]} caption={STEP_CAPTIONS[step - 1]} />;
}
