import { configure } from '@testing-library/react';
// Real helmd + SSE round trips exceed the 1s default under full-suite load.
configure({ asyncUtilTimeout: 5_000 });
