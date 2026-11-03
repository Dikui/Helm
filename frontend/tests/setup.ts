import { configure } from '@testing-library/react';
// Real helmd + SSE round trips exceed the 1s default under full-suite load.
configure({ asyncUtilTimeout: 5_000 });

// Substitute only the native dialog platform API in jsdom.
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
URL.createObjectURL = file => `blob:${(file as File).name}`;
URL.revokeObjectURL = () => {};
