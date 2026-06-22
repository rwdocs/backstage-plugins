const mountRw = jest.fn(() => ({
  destroy: jest.fn(),
  navigateTo: jest.fn(),
  setColorScheme: jest.fn(),
}));
module.exports = { mountRw };
