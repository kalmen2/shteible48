import React from 'react';
import { format } from 'date-fns';
import { toLocalDate } from '@/utils/dates';
import { resolveStatementTemplate } from '@/utils/statementTemplate';

const GuestInvoiceTemplate = React.forwardRef(
  ({ guest, charges = [], payments = [], totalCharges = 0, totalPayments = 0, template }, ref) => {
    const resolvedTemplate = React.useMemo(() => resolveStatementTemplate(template), [template]);

    const fontSize = resolvedTemplate.body_font_size || 14;
    const subtitleSize = Math.round((resolvedTemplate.header_font_size || 32) * 0.4);

    const allDates = React.useMemo(
      () =>
        [...charges, ...payments]
          .map((item) => (item?.date ? toLocalDate(item.date) : null))
          .filter(Boolean),
      [charges, payments]
    );

    const periodLabel = React.useMemo(() => {
      if (allDates.length === 0) {
        return format(new Date(), 'MMMM yyyy');
      }
      const min = new Date(Math.min(...allDates.map((d) => d.getTime())));
      const max = new Date(Math.max(...allDates.map((d) => d.getTime())));
      const sameMonth = min.getFullYear() === max.getFullYear() && min.getMonth() === max.getMonth();
      if (sameMonth) return format(min, 'MMMM yyyy');
      return `${format(min, 'MMM yyyy')} - ${format(max, 'MMM yyyy')}`;
    }, [allDates]);

    return (
      <div
        ref={ref}
        style={{
          fontFamily: 'Arial, sans-serif',
          padding: '32px',
          color: '#0f172a',
          backgroundColor: '#f8fafc',
        }}
      >
        <div
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '28px',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '30px',
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  color: resolvedTemplate.header_color,
                  fontSize: `${resolvedTemplate.header_font_size}px`,
                  fontWeight: 'bold',
                }}
              >
                {resolvedTemplate.header_title}
              </h1>
              <h2
                style={{
                  margin: '6px 0 0 0',
                  color: '#64748b',
                  fontSize: `${subtitleSize}px`,
                  fontWeight: 'normal',
                }}
              >
                {resolvedTemplate.header_subtitle}
              </h2>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '6px' }}>
                {guest.full_name}
              </div>
              {(guest.guest_id || guest.id) && resolvedTemplate.show_member_id && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  ID: {guest.guest_id || guest.id}
                </div>
              )}
              {resolvedTemplate.show_email && guest.email && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{guest.email}</div>
              )}
              {guest.phone && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{guest.phone}</div>
              )}
              {guest.address && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{guest.address}</div>
              )}
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
                Statement date: {format(new Date(), 'MMMM d, yyyy')}
              </div>
            </div>
          </div>

          <div
            style={{
              marginBottom: '28px',
              padding: '16px',
              backgroundColor: '#f1f5f9',
              borderLeft: `4px solid ${resolvedTemplate.header_color}`,
              borderRadius: '10px',
            }}
          >
            <div style={{ fontSize: `${fontSize}px`, color: '#475569' }}>Statement Period</div>
            <div
              style={{
                fontSize: `${Math.round(fontSize * 1.2)}px`,
                fontWeight: 'bold',
                color: resolvedTemplate.header_color,
                marginTop: '6px',
              }}
            >
              {periodLabel}
            </div>
          </div>

          {/* Charges Section */}
          {resolvedTemplate.show_charges_section && (
            <div style={{ marginBottom: '30px' }}>
              <h3
                style={{
                  color: '#334155',
                  borderBottom: `2px solid ${resolvedTemplate.header_color}`,
                  paddingBottom: '10px',
                  fontSize: `${fontSize + 2}px`,
                  fontWeight: '700',
                }}
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
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Description
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {charges.length === 0 ? (
                    <tr>
                      <td colSpan="3" style={{ padding: '12px', color: '#64748b' }}>
                        No charges this period.
                      </td>
                    </tr>
                  ) : (
                    charges.map((charge, index) => (
                      <tr key={charge.id || index}>
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
                            color: resolvedTemplate.charges_color,
                            fontWeight: 600,
                          }}
                        >
                          ${Number(charge.amount || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#fef3c7' }}>
                    <td colSpan="2" style={{ padding: '12px', fontWeight: 'bold', fontSize: `${fontSize}px` }}>
                      Total Charges
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        color: resolvedTemplate.charges_color,
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      ${Number(totalCharges || 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Payments Section */}
          {resolvedTemplate.show_payments_section && (
            <div style={{ marginBottom: '30px' }}>
              <h3
                style={{
                  color: '#334155',
                  borderBottom: `2px solid ${resolvedTemplate.header_color}`,
                  paddingBottom: '10px',
                  fontSize: `${fontSize + 2}px`,
                  fontWeight: '700',
                }}
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
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Description
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '12px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan="3" style={{ padding: '12px', color: '#64748b' }}>
                        No payments this period.
                      </td>
                    </tr>
                  ) : (
                    payments.map((payment, index) => (
                      <tr key={payment.id || index}>
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
                            color: resolvedTemplate.payments_color,
                            fontWeight: 600,
                          }}
                        >
                          -${Number(payment.amount || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#dcfce7' }}>
                    <td colSpan="2" style={{ padding: '12px', fontWeight: 'bold', fontSize: `${fontSize}px` }}>
                      Total Payments
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        color: resolvedTemplate.payments_color,
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      -${Number(totalPayments || 0).toFixed(2)}
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
              borderRadius: '10px',
              marginTop: '20px',
              borderLeft: `5px solid ${resolvedTemplate.balance_color}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: `${fontSize + 2}px`, fontWeight: 'bold', color: '#334155' }}>
                Balance Due
              </span>
              <span
                style={{
                  fontSize: `${Math.round(fontSize * 1.6)}px`,
                  fontWeight: 'bold',
                  color:
                    (guest.total_owed || 0) > 0 ? resolvedTemplate.balance_color : resolvedTemplate.payments_color,
                }}
              >
                ${(guest.total_owed || 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Footer */}
          {resolvedTemplate.show_footer && (
            <div
              style={{
                marginTop: '32px',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: `${Math.round(fontSize * 0.9)}px`,
              }}
            >
              <p style={{ margin: 0 }}>{resolvedTemplate.footer_text}</p>
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default GuestInvoiceTemplate;
