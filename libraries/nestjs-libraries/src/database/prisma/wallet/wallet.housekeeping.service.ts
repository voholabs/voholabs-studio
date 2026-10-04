import { Injectable } from '@nestjs/common';

// Periodic wallet jobs (storage month pass, short-forecast notices,
// reconciliation). Built in stream S7.
@Injectable()
export class WalletHousekeepingService {}
