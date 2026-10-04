import { Injectable } from '@nestjs/common';
import { Activity } from 'nestjs-temporal-core';

// Wallet housekeeping activities. Built in stream S7.
@Injectable()
@Activity()
export class WalletActivity {}
