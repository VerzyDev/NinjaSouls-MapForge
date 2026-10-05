import type { ThingType, FrameDuration, ThingCategory } from '~/domain/tibia';

export const AnimationMode = {
  SYNCHRONOUS: 1,
  ASYNCHRONOUS: 0
} as const;

export const AnimationDirection = {
  FORWARD: 0,
  BACKWARD: 1
} as const;

export const FrameControl = {
  RANDOM: 0xfe,
  AUTOMATIC: -1,
  ASYNCHRONOUS: 0xff
} as const;

export function getFrameDuration(frameDuration: FrameDuration): number {
  if (frameDuration.minimum === frameDuration.maximum) {
    return frameDuration.minimum;
  }

  return frameDuration.minimum + Math.round(Math.random() * (frameDuration.maximum - frameDuration.minimum));
}

export function getDefaultDuration(category: ThingCategory): number {
  switch (category) {
    case 'outfit':
      return 300;
    case 'effect':
      return 100;
    case 'missile':
      return 75;
    default:
      return 500;
  }
}

export function generateDefaultDurations(thing: ThingType, category: ThingCategory): FrameDuration[] {
  if (thing.frameDurations && thing.frameDurations.length === thing.frames) {
    return thing.frameDurations;
  }

  const duration = getDefaultDuration(category);
  const durations: FrameDuration[] = [];
  for (let i = 0; i < thing.frames; i++) {
    durations.push({ minimum: duration, maximum: duration });
  }

  return durations;
}

export function shouldSkipFirstFrame(thing: ThingType, category: ThingCategory): boolean {
  return category === 'outfit' && !thing.animateAlways;
}

export function getStartFrame(thing: ThingType): number {
  if (thing.startFrame > -1) {
    return thing.startFrame;
  }

  return Math.floor(Math.random() * thing.frames);
}

export function getLoopFrame(currentFrame: number, frames: number, loopCount: number, currentLoop: number): number {
  const nextFrame = currentFrame + 1;

  if (nextFrame < frames) {
    return nextFrame;
  }

  if (loopCount === 0) {
    return 0;
  }

  if (currentLoop < loopCount - 1) {
    return 0;
  }

  return currentFrame;
}

export function getPingPongFrame(
  currentFrame: number,
  frames: number,
  direction: number
): { frame: number; newDirection: number } {
  const count = direction === AnimationDirection.FORWARD ? 1 : -1;
  let nextFrame = currentFrame + count;

  let newDirection = direction;

  if (nextFrame < 0 || nextFrame >= frames) {
    newDirection = direction === AnimationDirection.FORWARD ? AnimationDirection.BACKWARD : AnimationDirection.FORWARD;
    nextFrame = currentFrame - count;
  }

  return { newDirection, frame: nextFrame };
}
