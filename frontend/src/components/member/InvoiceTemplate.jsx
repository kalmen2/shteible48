import React from "react";
import { format } from "date-fns";

const InvoiceTemplate = React.forwardRef(({ member, charges, payments, totalCharges, totalPayments }, ref) => {
  return (
    <div ref={ref} style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ marginBottom: '40px', borderBottom: '3px solid #1e3a8a', paddingBottom: '20px' }}>
        <h1 style={{ fontSize: '32px', margin: '0 0 10px 0', color: '#1e3a8a' }}>Member Statement</h1>
        <p style={{ margin: '0', color: '#64748b', fontSize: '14px' }}>
          Generated on {format(new Date(), 'MMMM d, yyyy')}
        </p>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#1e3a8a' }}>Member Information</h2>
        <div style={{ fontSize: '14px', lineHeight: '1.8', color: '#334155' }}>
          <div><strong>Name:</strong> {member.full_name}</div>
          {(member.member_id || member.id) && <div><strong>Member ID:</strong> {member.member_id || member.id}</div>}
          {member.email && <div><strong>Email:</strong> {member.email}</div>}
          {member.phone && <div><strong>Phone:</strong> {member.phone}</div>}
          {member.address && <div><strong>Address:</strong> {member.address}</div>}
        </div>
      </div>

      {charges.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#1e3a8a' }}>Charges</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Date</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Description</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((charge) => (
                <tr key={charge.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px' }}>{format(new Date(charge.date), 'MMM d, yyyy')}</td>
                  <td style={{ padding: '12px' }}>
                    {charge.description}
                    {charge.category && <div style={{ fontSize: '12px', color: '#64748b' }}>{charge.category}</div>}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                    ${charge.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr style={{ backgroundColor: '#fef3c7', fontWeight: 'bold' }}>
                <td colSpan="2" style={{ padding: '12px', textAlign: 'right' }}>Total Charges:</td>
                <td style={{ padding: '12px', textAlign: 'right', fontSize: '16px' }}>
                  ${totalCharges.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {payments.length > 0 && (
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#1e3a8a' }}>Payments</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Date</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Description</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px' }}>{format(new Date(payment.date), 'MMM d, yyyy')}</td>
                  <td style={{ padding: '12px' }}>{payment.description}</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                    ${payment.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr style={{ backgroundColor: '#d1fae5', fontWeight: 'bold' }}>
                <td colSpan="2" style={{ padding: '12px', textAlign: 'right' }}>Total Payments:</td>
                <td style={{ padding: '12px', textAlign: 'right', fontSize: '16px' }}>
                  ${totalPayments.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ 
        marginTop: '40px', 
        padding: '20px', 
        backgroundColor: '#f1f5f9', 
        borderRadius: '8px',
        borderLeft: '4px solid #1e3a8a'
      }}>
        <div style={{ fontSize: '16px', color: '#475569', marginBottom: '5px' }}>Balance Owed</div>
        <div style={{ fontSize: '32px', fontWeight: 'bold', color: (member.total_owed || 0) > 0 ? '#d97706' : '#059669' }}>
          ${(member.total_owed || 0).toFixed(2)}
        </div>
      </div>
    </div>
  );
});

InvoiceTemplate.displayName = 'InvoiceTemplate';

export default InvoiceTemplate;
