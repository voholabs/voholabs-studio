import { useEffect, useState } from 'react';

// The width the app switches to its phone layout at (the mobile: screen).
export const MOBILE_MEDIA_QUERY = '(max-width: 1025px)';

// False until mounted, so it is safe in a server render (unlike
// useMediaQuery from @uidotdev/usehooks, which throws there).
export function useMediaMatch(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
