export interface MockProduct {
  id: number
  title: string
  price: string
  image: string
  category: string
}

export const MOCK_PRODUCTS: MockProduct[] = [
  { id: 1, title: 'Obsidian Chronograph', price: '$349.00', image: 'https://picsum.photos/seed/watch1/600/500', category: 'Accessories' },
  { id: 2, title: 'The Linen Oversized Tee', price: '$68.00', image: 'https://picsum.photos/seed/tee22/600/500', category: 'Apparel' },
  { id: 3, title: 'Midnight Pour Candle', price: '$42.00', image: 'https://picsum.photos/seed/candle9/600/500', category: 'Home' },
  { id: 4, title: 'Ceramic Pour-Over Set', price: '$89.00', image: 'https://picsum.photos/seed/ceramic5/600/500', category: 'Kitchen' },
  { id: 5, title: 'Leather Cardholder Slim', price: '$55.00', image: 'https://picsum.photos/seed/leather7/600/500', category: 'Accessories' },
  { id: 6, title: 'Frosted Glass Tumbler', price: '$38.00', image: 'https://picsum.photos/seed/glass3/600/500', category: 'Kitchen' },
  { id: 7, title: 'Vintage Denim Jacket', price: '$198.00', image: 'https://picsum.photos/seed/denim11/600/500', category: 'Apparel' },
  { id: 8, title: 'Sage & Smoke Diffuser', price: '$72.00', image: 'https://picsum.photos/seed/diffuser4/600/500', category: 'Home' },
]
