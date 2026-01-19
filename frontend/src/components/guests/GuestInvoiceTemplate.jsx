import React from 'react';
import { format } from 'date-fns';
import { toLocalDate } from '@/utils/dates';

const GuestInvoiceTemplate = React.forwardRef(
  ({ guest, transactions, totalCharges, totalPayments }, ref) => {
    const charges = transactions.filter((t) => t.type === 'charge');
    const payments = transactions.filter((t) => t.type === 'payment');

    return (
      <div
        ref={ref}
        style={{
          fontFamily: 'Arial, sans-serif',
          padding: '40px',
          maxWidth: '800px',
          margin: '0 auto',
        }}
      >
        {/* Header */}
        <div
          style={{ marginBottom: '30px', borderBottom: '2px solid #1e3a8a', paddingBottom: '20px' }}
        >
          <h1 style={{ margin: 0, color: '#1e3a8a', fontSize: '28px' }}>Shtiebel48</h1>
          <h2
            style={{
              margin: '5px 0 0 0',
              color: '#64748b',
              fontSize: '16px',
              fontWeight: 'normal',
            }}
          >
            Guest Statement
          </h2>
        </div>

        {/* Guest Info */}
        <div
          style={{
            marginBottom: '30px',
            backgroundColor: '#f8fafc',
            padding: '20px',
            borderRadius: '8px',
          }}
        >
          <h3 style={{ margin: '0 0 10px 0', color: '#334155' }}>Guest Information</h3>
          <p style={{ margin: '5px 0', color: '#475569' }}>
            <strong>Name:</strong> {guest.full_name}
          </p>
          {(guest.guest_id || guest.id) && (
            <p style={{ margin: '5px 0', color: '#475569' }}>
              <strong>Guest ID:</strong> {guest.guest_id || guest.id}
            </p>
          )}
          {guest.email && (
            <p style={{ margin: '5px 0', color: '#475569' }}>
              <strong>Email:</strong> {guest.email}
            </p>
          )}
          {guest.phone && (
            <p style={{ margin: '5px 0', color: '#475569' }}>
              <strong>Phone:</strong> {guest.phone}
            </p>
          )}
          {guest.address && (
            <p style={{ margin: '5px 0', color: '#475569' }}>
              <strong>Address:</strong> {guest.address}
            </p>
          )}
          <p style={{ margin: '10px 0 0 0', color: '#475569' }}>
            <strong>Statement Date:</strong> {format(new Date(), 'MMMM d, yyyy')}
          </p>
        </div>

        {/* Charges Section */}
        {charges.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h3
              style={{ color: '#334155', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}
            >
              Charges
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Date
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Description
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {charges.map((charge, index) => (
                  <tr key={index}>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0' }}>
                      {charge.date ? format(toLocalDate(charge.date), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0' }}>
                      {charge.description}
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        textAlign: 'right',
                        color: '#d97706',
                      }}
                    >
                      ${charge.amount?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#fef3c7' }}>
                  <td colSpan="2" style={{ padding: '12px', fontWeight: 'bold' }}>
                    Total Charges
                  </td>
                  <td
                    style={{
                      padding: '12px',
                      textAlign: 'right',
                      fontWeight: 'bold',
                      color: '#d97706',
                    }}
                  >
                    ${totalCharges.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Payments Section */}
        {payments.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h3
              style={{ color: '#334155', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}
            >
              Payments
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Date
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Description
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '12px',
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment, index) => (
                  <tr key={index}>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0' }}>
                      {payment.date ? format(toLocalDate(payment.date), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid #e2e8f0' }}>
                      {payment.description}
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        textAlign: 'right',
                        color: '#16a34a',
                      }}
                    >
                      -${payment.amount?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#dcfce7' }}>
                  <td colSpan="2" style={{ padding: '12px', fontWeight: 'bold' }}>
                    Total Payments
                  </td>
                  <td
                    style={{
                      padding: '12px',
                      textAlign: 'right',
                      fontWeight: 'bold',
                      color: '#16a34a',
                    }}
                  >
                    -${totalPayments.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Balance Summary */}
        <div
          style={{
            padding: '20px',
            backgroundColor: (guest.total_owed || 0) > 0 ? '#fef3c7' : '#dcfce7',
            borderRadius: '8px',
            marginTop: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155' }}>
              Balance Due
            </span>
            <span
              style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: (guest.total_owed || 0) > 0 ? '#d97706' : '#16a34a',
              }}
            >
              ${(guest.total_owed || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
          <p>Thank you for your support!</p>
          <p>Questions? Please contact us.</p>
        </div>
      </div>
    );
  }
);

GuestInvoiceTemplate.displayName = 'GuestInvoiceTemplate';

export default GuestInvoiceTemplate;
