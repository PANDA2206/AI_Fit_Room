import React, { useMemo, useState } from 'react';
import './CartPage.css';

const PaymentOption = ({ id, label, description, selected, onSelect }) => (
  <label className={`payment-option ${selected ? 'selected' : ''}`} htmlFor={id}>
    <input
      type="radio"
      id={id}
      name="payment-method"
      checked={selected}
      onChange={() => onSelect(id)}
    />
    <div>
      <div className="payment-label">{label}</div>
      <div className="payment-description">{description}</div>
    </div>
  </label>
);

const CartPage = ({ items = [], onUpdateQuantity, onRemove, onClear }) => {
  const [paymentMethod, setPaymentMethod] = useState('upi');

  const { subtotal, currency, displayItems } = useMemo(() => {
    const currencyGuess = items.find((item) => item?.currency)?.currency || 'INR';
    const mapped = items.map((item) => ({
      ...item,
      quantity: Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
        ? Number(item.quantity)
        : 1,
      price: Number.isFinite(Number(item.price)) && Number(item.price) >= 0
        ? Number(item.price)
        : 0
    }));
    const total = mapped.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
    return { subtotal: total, currency: currencyGuess, displayItems: mapped };
  }, [items]);

  const formatPrice = (value) => {
    const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(safeValue);
  };

  return (
    <div className="cart-page">
      <div className="cart-header">
        <div>
          <p className="eyebrow">Your Session Cart</p>
          <h2>Looks ready for checkout</h2>
        </div>
        <div className="cart-actions">
          <button type="button" className="ghost" onClick={onClear} disabled={items.length === 0}>
            Clear Cart
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-cart">No items yet. Add a look from the Try-On view.</div>
      ) : (
        <div className="cart-grid">
          <section className="cart-items">
            {displayItems.map((item) => (
              <article key={item.id} className="cart-item">
                <div className="cart-thumb">
                  {item.image ? <img src={item.image} alt={item.name} loading="lazy" /> : <div className="placeholder">Look</div>}
                </div>
                <div className="cart-info">
                  <h3>{item.name}</h3>
                  <p className="cart-meta">
                    {item.brand || 'Atelier Line'}
                    {item.articleType ? ` · ${item.articleType}` : item.subcategory ? ` · ${item.subcategory}` : ''}
                  </p>
                  <div className="cart-controls">
                    <div className="quantity">
                      <button type="button" onClick={() => onUpdateQuantity(item.id, -1)} aria-label="Decrease quantity">
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => onUpdateQuantity(item.id, 1)} aria-label="Increase quantity">
                        +
                      </button>
                    </div>
                    <button type="button" className="link" onClick={() => onRemove(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="cart-price">{item.price ? formatPrice(item.price) : 'Preview'}</div>
              </article>
            ))}
          </section>

          <aside className="cart-summary">
            <div className="summary-block">
              <div className="summary-row">
                <span>Items</span>
                <span>{items.length}</span>
              </div>
              <div className="summary-row">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="summary-row note">Shipping & taxes calculated at payment</div>
            </div>

            <div className="summary-block">
              <p className="eyebrow">Payment</p>
              <PaymentOption
                id="upi"
                label="UPI / Wallets"
                description="Pay instantly via UPI apps"
                selected={paymentMethod === 'upi'}
                onSelect={setPaymentMethod}
              />
              <PaymentOption
                id="card"
                label="Card"
                description="Visa, Mastercard, Amex"
                selected={paymentMethod === 'card'}
                onSelect={setPaymentMethod}
              />
              <PaymentOption
                id="cod"
                label="Cash on Delivery"
                description="Pay when the order arrives"
                selected={paymentMethod === 'cod'}
                onSelect={setPaymentMethod}
              />
            </div>

            <button type="button" className="checkout-btn" disabled={items.length === 0}>
              Proceed to Pay {items.length > 0 ? `· ${formatPrice(subtotal)}` : ''}
            </button>
            <p className="small-print">Mock checkout for demo. No payment will be processed.</p>
          </aside>
        </div>
      )}
    </div>
  );
};

export default CartPage;
