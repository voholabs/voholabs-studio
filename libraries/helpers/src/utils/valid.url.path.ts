import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { AUDIO_EXTENSIONS } from '@gitroom/helpers/utils/has.extension';

// The media library keeps mp3 and wav audio for the agent to download; a post never
// carries it, whichever route the attachment comes in by
export const AUDIO_ATTACHMENT_ERROR =
  'Audio files (.mp3, .wav) cannot be attached to a post. They stay in the media library as files to download.';

export const isAudioPath = (text: string) => {
  const path = text?.split?.('?')?.[0].toLowerCase() || '';
  return AUDIO_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`));
};

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return (
      !!text?.split?.('?')?.[0].endsWith('.png') ||
      !!text?.split?.('?')?.[0].endsWith('.jpg') ||
      !!text?.split?.('?')?.[0].endsWith('.jpeg') ||
      !!text?.split?.('?')?.[0].endsWith('.gif') ||
      !!text?.split?.('?')?.[0].endsWith('.webp') ||
      !!text?.split?.('?')?.[0].endsWith('.mp4')
    );
  }

  defaultMessage(args: ValidationArguments) {
    if (isAudioPath(args?.value)) {
      return AUDIO_ATTACHMENT_ERROR;
    }
    // here you can provide default error message if validation failed
    return (
      'File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4'
    );
  }
}

// also used for media urls that don't come through a DTO, like pictures in a post body
export const isAllowedUploadPath = (text: string) => {
  if (!process.env.RESTRICT_UPLOAD_DOMAINS) {
    return true;
  }

  return (
    (text || 'invalid url').indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) > -1
  );
};

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return isAllowedUploadPath(text);
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'URL must contain the domain: ' + process.env.RESTRICT_UPLOAD_DOMAINS + ' Make sure you first use the upload API route.'
    );
  }
}
