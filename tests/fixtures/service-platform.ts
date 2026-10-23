// Exercise both service managers through the compiled CLI without touching the host services.
Object.defineProperty(process, 'platform', { value: process.env.HELM_TEST_SERVICE_PLATFORM });
