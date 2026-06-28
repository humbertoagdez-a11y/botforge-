import Bull from 'bull';
import { env } from '../config/env';

export interface ProcessDocumentJobData {
  documentId: string;
}

export const documentQueue = new Bull<ProcessDocumentJobData>('document-processing', env.REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
