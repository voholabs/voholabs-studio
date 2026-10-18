export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  if (!path) {
    return false;
  }
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return path.toLowerCase().indexOf(ext.toLowerCase()) > -1;
};

// Audio the media library keeps for the agent (voice-overs); never a post
// attachment
export const AUDIO_EXTENSIONS = ['mp3', 'wav'];

export const isAudioFile = (path: string | undefined | null): boolean =>
  AUDIO_EXTENSIONS.some((extension) => hasExtension(path, extension));
