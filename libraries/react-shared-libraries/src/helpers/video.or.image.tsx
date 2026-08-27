'use client';

import {
  FC,
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
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
 * The whole image, over the page, at whatever size the screen allows. A preview
 * pane is a fixed height and most images are not that shape, so this is where
 * you actually look at one - without losing your place in the feed.
 */
const Lightbox: FC<{ src: string; onClose: () => void }> = ({
  src,
  onClose,
}) => {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-[20px] cursor-zoom-out"
    >
      <img
        src={src}
        // The click that opened this must not close it again on the way back up.
        onClick={(event) => event.stopPropagation()}
        className="max-w-full max-h-full object-contain cursor-default"
      />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-[16px] end-[16px] w-[36px] h-[36px] rounded-full bg-black/60 hover:bg-black/80 text-white text-[20px] leading-none flex items-center justify-center"
      >
        ×
      </button>
    </div>,
    document.body
  );
};

/**
 * Media inside a preview, as the previews want it: a video stays put and plays
 * where it is - sending it to a tab of its own is what stops you from watching
 * it in place - and an image opens full size over the page.
 *
 * Images are contained rather than cropped. Once the wrapper actually fills its
 * pane (see SliderComponent), `object-fit` decides what a photo that is not the
 * pane's shape does, and cropping a 9:16 photo into a 280px-tall pane leaves a
 * band across the middle of it. The whole image shows instead, with the
 * lightbox a click away for a proper look at it.
 */
export const MediaPreview: FC<{
  src: string;
  className?: string;
  isContain?: boolean;
  imageClassName?: string;
  videoClassName?: string;
}> = (props) => {
  const { src, className, isContain = true, ...rest } = props;
  const [zoomed, setZoomed] = useState(false);

  const open = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click still means "open it in a tab of its own", and the card
    // underneath this has a click of its own that must not fire.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setZoomed(true);
  }, []);

  const close = useCallback(() => setZoomed(false), []);

  if (hasExtension(src, 'mp4')) {
    return (
      <div className={className}>
        <VideoOrImage
          autoplay={true}
          src={src}
          isContain={isContain}
          {...rest}
        />
      </div>
    );
  }

  return (
    <>
      <a
        className={clsx(className, 'cursor-zoom-in')}
        href={src}
        target="_blank"
        onClick={open}
      >
        <VideoOrImage
          autoplay={true}
          src={src}
          isContain={isContain}
          {...rest}
        />
      </a>
      {zoomed && <Lightbox src={src} onClose={close} />}
    </>
  );
};
