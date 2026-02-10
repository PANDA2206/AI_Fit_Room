import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./components/CameraFeed', () => () => <div data-testid="camera-feed" />);
jest.mock('./components/ClothSelector', () => () => <div data-testid="cloth-selector" />);
jest.mock('./components/CustomerQueryChat', () => () => <div data-testid="customer-query-chat" />);

jest.mock('./services/socket', () => {
  const on = jest.fn();
  return {
    connectSocket: () => ({ on }),
    disconnectSocket: jest.fn()
  };
});

test('renders main app sections', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /virtual try-on/i })).toBeInTheDocument();
  expect(screen.getByTestId('cloth-selector')).toBeInTheDocument();
  expect(screen.getByTestId('camera-feed')).toBeInTheDocument();
  expect(screen.getByTestId('customer-query-chat')).toBeInTheDocument();
});
