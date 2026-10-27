import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Splitter } from '../src/shared/Splitter.js';

afterEach(cleanup);

test('分界线用方向键调整尺寸，夹在上下限之间，双击恢复默认', () => {
  const sizes: (number | undefined)[] = [];
  let size = 300;
  render(<Splitter label="调整侧栏宽度" orientation="vertical" min={220} max={() => 400} measure={() => size}
    onResize={value => { sizes.push(value); size = value ?? 300; }} />);
  const separator = screen.getByRole('separator', { name: '调整侧栏宽度' });
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
  fireEvent.doubleClick(separator);
  expect(sizes).toEqual([316, 380, 400, 336, undefined]);
});

test('向上拖动变大的分界线，方向键反向', () => {
  const sizes: (number | undefined)[] = [];
  render(<Splitter label="调整输入区高度" orientation="horizontal" grow={-1} min={120} max={() => 500} measure={() => 200}
    onResize={value => sizes.push(value)} />);
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' });
  expect(sizes).toEqual([216]);
});
