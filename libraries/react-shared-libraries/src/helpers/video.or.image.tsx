'use client';

import { FC, MouseEvent, useCallback, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

/** Roughly the browser's own control bar - it is not exposed to the page. */
const CONTROL_BAR_HEIGHT = 44;

/**
 * A video in a preview starts as a silent looping thumbnail, but it is still a
 * video someone may want to actually watch. Hovering hands over the native
 * controls - play/pause, scrubbing, volume - and the first click turns the
 * loop into a real playback with sound.
 */
const InlineVideo: FC<{
  src: string;
  autoplay: boolean;
  className?: string;
}> = ({ src, autoplay, className }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [watching, setWatching] = useState(false);

  const click = useCallback(
    (event: MouseEvent<HTMLVideoElement>) => {
      const video = ref.current;
      if (watching || !video) {
        // The controls own the video from here.
        return;
      }

      // A click on the control bar means whatever the button under it says -
      // only a click on the picture itself means "let me watch this".
      const { bottom } = video.getBoundingClientRect();
      const onControls = event.clientY > bottom - CONTROL_BAR_HEIGHT;

      setWatching(true);
      video.muted = false;
      video.loop = false;

      if (!onControls) {
        // Left alone the browser reads the click as "pause the preview".
        event.preventDefault();
        // Autoplay may have been blocked, so this can be the actual start.
        // Nothing to recover from if it is refused.
        video.play().catch(() => {});
      }
    },
    [watching]
  );

  return (
    <video
      ref={ref}
      src={src}
      // Only the silent preview starts on its own - once it is a real playback
      // the viewer decides when it runs.
      autoPlay={autoplay}
      muted={true}
      loop={true}
      playsInline={true}
      preload="metadata"
      controls={hovered || watching}
      controlsList="nodownload"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={click}
      className={clsx('w-full h-full', className)}
    />
  );
};

export const VideoOrImage: FC<{
  src: string;
  autoplay: boolean;
  isContain?: boolean;
  imageClassName?: string;
  videoClassName?: string;
}> = (props) => {
  const { src, autoplay, isContain, imageClassName, videoClassName } = props;
  if (hasExtension(src, 'mp4')) {
    return (
      <InlineVideo src={src} autoplay={autoplay} className={videoClassName} />
    );
  }
  return (
    <img
      className={clsx(
        isContain ? 'object-contain' : 'object-cover',
        'w-full h-full',
        imageClassName
      )}
      src={src}
    />
  );
};

/**
 * Media inside a preview, as the previews want it: an image opens full size in
 * a new tab, a video stays put and plays where it is - sending it to a tab of
 * its own is what stops you from watching it in place.
 */
export const MediaPreview: FC<{
  src: string;
  className?: string;
  isContain?: boolean;
  imageClassName?: string;
  videoClassName?: string;
}> = (props) => {
  const { src, className, ...rest } = props;

  if (hasExtension(src, 'mp4')) {
    return (
      <div className={className}>
        <VideoOrImage autoplay={true} src={src} {...rest} />
      </div>
    );
  }

  return (
    <a className={className} href={src} target="_blank">
      <VideoOrImage autoplay={true} src={src} {...rest} />
    </a>
  );
};
