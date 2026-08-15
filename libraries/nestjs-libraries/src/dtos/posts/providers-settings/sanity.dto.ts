import { IsDefined, IsString, MinLength } from 'class-validator';

export class SanityDto {
  // The published id of the Sanity document (never the `drafts.` prefixed one).
  // The content itself is never copied into Postiz - this id is the only thing
  // we hold on to, and everything shown to the user is read live from Sanity.
  @IsString()
  @IsDefined()
  @MinLength(1)
  documentId: string;
}
