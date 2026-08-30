import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export type PostListStateFilter = 'all' | 'scheduled' | 'draft' | 'published';

export type PostListReviewedFilter = 'all' | 'reviewed' | 'unreviewed';

export class GetPostsListDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  customer?: string;

  // Narrow the list to one channel. Without it a caller interested in a single
  // channel has to page through everything and filter client-side, which
  // silently drops rows once the list is longer than one page.
  @IsOptional()
  @IsString()
  integration?: string;

  @IsOptional()
  @IsIn(['all', 'scheduled', 'draft', 'published'])
  state?: PostListStateFilter = 'all';

  // The reviewed mark is a note to self, so it cuts across every state: you
  // want "everything I have not eyeballed yet" regardless of whether it is a
  // draft or already queued.
  @IsOptional()
  @IsIn(['all', 'reviewed', 'unreviewed'])
  reviewed?: PostListReviewedFilter = 'all';
}
