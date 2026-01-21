import React from 'react';
import { format } from 'date-fns';
import { toLocalDate } from '@/utils/dates';
import { resolveStatementTemplate } from '@/utils/statementTemplate';
import {
  getParsha,
  getHolidaysByDate,
  isShabbat,
  getHebrewDate,
} from '../calendar/hebrewDateConverter';

const InvoiceTemplate = React.forwardRef(
  ({ member, charges, payments, totalCharges, totalPayments, template }, ref) => {
    const resolvedTemplate = React.useMemo(
      () => resolveStatementTemplate(template),
      [template]
    );

    const holidayMap = React.useMemo(() => {
      if (!charges.length) return {};
      const dates = charges.map((charge) => toLocalDate(charge.date)).filter(Boolean);
      if (dates.length === 0) return {};
      const min = new Date(Math.min(...dates.map((d) => d.getTime())));
      const max = new Date(Math.max(...dates.map((d) => d.getTime())));
      return getHolidaysByDate(min, max);
    }, [charges]);

    const getSpecialDayLabel = (date) => {
      if (!date) return '';
      const key = format(date, 'yyyy-MM-dd');
      const holidays = holidayMap[key];
      if (holidays && holidays.length > 0) {
        return holidays.join(', ');
      }
      if (isShabbat(date)) {
        const parsha = getParsha(date);
        return parsha ? `Shabbat - ${parsha}` : 'Shabbat';
      }
      return '';
    };

    const getHebrewDateLabel = (date) => {
      if (!date) return '';
      const hebrew = getHebrewDate(date);
      if (!hebrew) return '';
      const dayLabel = hebrew.dayHebrew || hebrew.day;
      return `${dayLabel} ${hebrew.month}`;
    };

    const fontSize = resolvedTemplate.body_font_size || 14;
    const subtitleSize = Math.round((resolvedTemplate.header_font_size || 32) * 0.4);
    const allDates = [...charges, ...payments]
      .map((item) => (item?.date ? toLocalDate(item.date) : null))
      .filter(Boolean);
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
          padding: '32px',
          fontFamily: 'Arial, sans-serif',
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '32px',
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: `${resolvedTemplate.header_font_size}px`,
                  fontWeight: 'bold',
                  color: resolvedTemplate.header_color,
                }}
              >
                {resolvedTemplate.header_title}
              </h1>
              <p
                style={{
                  margin: '6px 0 0 0',
                  color: '#64748b',
                  fontSize: `${subtitleSize}px`,
                }}
              >
                {resolvedTemplate.header_subtitle}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '6px' }}>
                {member.full_name}
              </div>
              {resolvedTemplate.show_member_id && (member.member_id || member.id) && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  ID: {member.member_id || member.id}
                </div>
              )}
              {resolvedTemplate.show_email && member.email && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{member.email}</div>
              )}
              {member.phone && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{member.phone}</div>
              )}
              {member.address && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>{member.address}</div>
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

          {resolvedTemplate.show_charges_section && (
            <div style={{ marginBottom: '28px' }}>
              <h2
                style={{
                  fontSize: `${fontSize + 2}px`,
                  fontWeight: '700',
                  marginBottom: '12px',
                  paddingBottom: '8px',
                  borderBottom: `2px solid ${resolvedTemplate.header_color}`,
                }}
              >
                Charges
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc' }}>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '10px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '10px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Description
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '10px',
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
                    charges.map((charge) => {
                      const date = charge.date ? toLocalDate(charge.date) : null;
                      const hebrewLabel = getHebrewDateLabel(date);
                      const specialLabel = getSpecialDayLabel(date);
                      return (
                        <tr key={charge.id || `${charge.date}-${charge.description}`}>
                          <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                            {date ? format(date, 'MMM d, yyyy') : 'N/A'}
                            {(hebrewLabel || specialLabel) && (
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                {[hebrewLabel, specialLabel].filter(Boolean).join(' • ')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                            {charge.description}
                          </td>
                          <td
                            style={{
                              padding: '10px',
                              borderBottom: '1px solid #e2e8f0',
                              textAlign: 'right',
                              color: resolvedTemplate.charges_color,
                              fontWeight: 600,
                            }}
                          >
                            ${Number(charge.amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#fef3c7' }}>
                    <td
                      colSpan="2"
                      style={{ padding: '10px', fontWeight: 'bold', fontSize: `${fontSize}px` }}
                    >
                      Total Charges
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        fontSize: `${fontSize}px`,
                        color: resolvedTemplate.charges_color,
                      }}
                    >
                      ${Number(totalCharges || 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {resolvedTemplate.show_payments_section && (
            <div style={{ marginBottom: '28px' }}>
              <h2
                style={{
                  fontSize: `${fontSize + 2}px`,
                  fontWeight: '700',
                  marginBottom: '12px',
                  paddingBottom: '8px',
                  borderBottom: `2px solid ${resolvedTemplate.header_color}`,
                }}
              >
                Payments
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc' }}>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '10px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '10px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      Description
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '10px',
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
                    payments.map((payment) => {
                      const date = payment.date ? toLocalDate(payment.date) : null;
                      return (
                        <tr key={payment.id || `${payment.date}-${payment.description}`}>
                          <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                            {date ? format(date, 'MMM d, yyyy') : 'N/A'}
                          </td>
                          <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0' }}>
                            {payment.description}
                          </td>
                          <td
                            style={{
                              padding: '10px',
                              borderBottom: '1px solid #e2e8f0',
                              textAlign: 'right',
                              color: resolvedTemplate.payments_color,
                              fontWeight: 600,
                            }}
                          >
                            -${Number(payment.amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#dcfce7' }}>
                    <td
                      colSpan="2"
                      style={{ padding: '10px', fontWeight: 'bold', fontSize: `${fontSize}px` }}
                    >
                      Total Payments
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        fontSize: `${fontSize}px`,
                        color: resolvedTemplate.payments_color,
                      }}
                    >
                      -${Number(totalPayments || 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div
            style={{
              marginTop: '32px',
              padding: '18px',
              backgroundColor: (member.total_owed || 0) > 0 ? '#fef3c7' : '#dcfce7',
              borderRadius: '10px',
              borderLeft: `5px solid ${resolvedTemplate.balance_color}`,
            }}
          >
            <div style={{ fontSize: `${fontSize + 2}px`, fontWeight: '700', color: '#334155' }}>
              Balance Owed
            </div>
            <div
              style={{
                fontSize: `${Math.round(fontSize * 2)}px`,
                fontWeight: 'bold',
                color:
                  (member.total_owed || 0) > 0
                    ? resolvedTemplate.balance_color
                    : resolvedTemplate.payments_color,
              }}
            >
              ${(member.total_owed || 0).toFixed(2)}
            </div>
          </div>

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

InvoiceTemplate.displayName = 'InvoiceTemplate';

export default InvoiceTemplate;
