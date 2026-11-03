import type { TCNSJobTypeRegistration } from './TCNSJobTypeRegistration';

export type TCNSJobTypeStatus = TCNSJobTypeRegistration & {
    handlers: number;
};
