import React from 'react';
import { ShippingDetails } from '../types';

interface ShippingDetailsFormProps {
  shipping: ShippingDetails;
  onChange: (field: keyof ShippingDetails, value: string) => void;
  className?: string;
}

const ShippingDetailsForm: React.FC<ShippingDetailsFormProps> = ({ shipping, onChange, className }) => {
  const renderField = (
    field: keyof ShippingDetails,
    label: string,
    placeholder = '',
    required = true
  ) => (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-1">
        {label}
        {required && ' *'}
      </label>
      <input
        value={shipping[field] ?? ''}
        onChange={(event) => onChange(field, event.target.value)}
        placeholder={placeholder}
        className="w-full bg-black border border-white/15 rounded px-3 py-2 text-white focus:border-brand-lime focus:outline-none transition-colors"
      />
    </div>
  );

  return (
    <div className={className}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderField('name', 'Full Name', 'Jordan Smith')}
        {renderField('email', 'Email Address', 'you@example.com')}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {renderField('addressLine1', 'Address Line 1', '123 Courtsight Ave')}
        {renderField('addressLine2', 'Address Line 2', 'Suite 402', false)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        {renderField('city', 'City', 'Toronto')}
        {renderField('province', 'Province / State', 'ON')}
        {renderField('postalCode', 'Postal / Zip', 'M5V 2H1')}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {renderField('country', 'Country', 'Canada')}
        {renderField('phone', 'Phone (optional)', '(555) 123-4567', false)}
      </div>
    </div>
  );
};

export default ShippingDetailsForm;
