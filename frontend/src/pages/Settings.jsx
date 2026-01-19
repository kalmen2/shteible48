import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Save, Eye, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['statementTemplates'],
    queryFn: () => base44.entities.StatementTemplate.list('-created_date', 1),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  const currentTemplate = templates[0] || {
    header_title: 'Shtiebel 48',
    header_subtitle: 'Manager',
    header_font_size: 32,
    header_color: '#1e3a8a',
    show_member_id: true,
    show_email: true,
    show_charges_section: true,
    show_payments_section: true,
    charges_color: '#d97706',
    payments_color: '#16a34a',
    balance_color: '#dc2626',
    body_font_size: 14,
    footer_text: 'Thank you for your support',
    show_footer: true,
  };

  const [template, setTemplate] = useState(currentTemplate);
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const currentPlan = plans[0];

  React.useEffect(() => {
    if (templates[0]) {
      setTemplate(templates[0]);
    }
  }, [templates]);

  const createTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.StatementTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statementTemplates'] });
      toast.success('Template saved successfully!');
    },
    onError: (error) => {
      toast.error('Failed to save template: ' + error.message);
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.StatementTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statementTemplates'] });
      toast.success('Template updated successfully!');
    },
    onError: (error) => {
      toast.error('Failed to update template: ' + error.message);
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: (planData) => base44.entities.MembershipPlan.create(planData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipPlans'] });
      setMonthlyAmount('');
      toast.success('Monthly amount saved successfully!');
    },
    onError: (error) => {
      toast.error('Failed to save: ' + error.message);
    },
  });

  const handleSave = () => {
    if (templates[0]) {
      updateTemplateMutation.mutate({ id: templates[0].id, data: template });
    } else {
      createTemplateMutation.mutate(template);
    }
  };

  const handleSaveMonthlyAmount = (e) => {
    e.preventDefault();
    createPlanMutation.mutate({
      standard_amount: parseFloat(monthlyAmount),
      is_active: true,
    });
  };

  const handlePreview = () => {
    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write('<html><head><title>Statement Preview</title>');
    printWindow.document.write(
      '<style>@media print { @page { margin: 0.5in; } } body { font-family: Arial, sans-serif; }</style>'
    );
    printWindow.document.write('</head><body>');
    printWindow.document.write(`
      <div style="padding: 40px;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px;">
          <div>
            <h1 style="margin: 0; font-size: ${template.header_font_size}px; font-weight: bold; color: ${template.header_color};">${template.header_title}</h1>
            <p style="margin: 5px 0 0 0; color: #64748b; font-size: ${Math.round(template.header_font_size * 0.4)}px;">${template.header_subtitle}</p>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">John Doe</div>
            ${template.show_member_id ? '<div style="font-size: 12px; color: #64748b;">ID: 123456</div>' : ''}
            ${template.show_email ? '<div style="font-size: 12px; color: #64748b;">john@example.com</div>' : ''}
          </div>
        </div>
        <div style="margin-bottom: 30px; padding: 15px; background-color: #f8fafc; border-left: 4px solid ${template.header_color};">
          <div style="font-size: ${template.body_font_size}px; color: #64748b;">Statement Period</div>
          <div style="font-size: ${Math.round(template.body_font_size * 1.3)}px; font-weight: bold; color: ${template.header_color};">December 2025</div>
        </div>

        ${
          template.show_charges_section
            ? `
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Charges</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8fafc;">
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Dec 1, 2025</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Monthly Membership</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.charges_color};">$50.00</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="background-color: #fef3c7;">
                <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Charges</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.charges_color};">$50.00</td>
              </tr>
            </tfoot>
          </table>
        </div>
        `
            : ''
        }

        ${
          template.show_payments_section
            ? `
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Payments</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8fafc;">
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Dec 15, 2025</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Payment - Check</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.payments_color};">$25.00</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="background-color: #dcfce7;">
                <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Payments</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.payments_color};">$25.00</td>
              </tr>
            </tfoot>
          </table>
        </div>
        `
            : ''
        }

        <div style="margin-top: 30px; padding: 20px; background-color: #fef3c7; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: ${template.body_font_size + 2}px; font-weight: bold;">Balance Owed</span>
            <span style="font-size: ${Math.round(template.body_font_size * 1.7)}px; font-weight: bold; color: ${template.balance_color};">$25.00</span>
          </div>
        </div>

        ${
          template.show_footer
            ? `
        <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: ${Math.round(template.body_font_size * 0.9)}px;">
          <p>${template.footer_text}</p>
        </div>
        `
            : ''
        }
      </div>
    `);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Settings</h1>
          <p className="text-slate-600">Customize your application settings</p>
        </div>

        <Tabs defaultValue="statement" className="w-full">
          <TabsList>
            <TabsTrigger value="statement" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Statement Template
            </TabsTrigger>
            <TabsTrigger value="monthly" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Monthly Charge
            </TabsTrigger>
          </TabsList>

          <TabsContent value="statement" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Editor Panel */}
              <Card className="border-slate-200 shadow-lg">
                <CardHeader className="border-b border-slate-200 bg-slate-50">
                  <CardTitle>Statement Template Editor</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  {/* Header Section */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b pb-2">Header Settings</h3>
                    <div className="space-y-2">
                      <Label>Header Title</Label>
                      <Input
                        value={template.header_title}
                        onChange={(e) => setTemplate({ ...template, header_title: e.target.value })}
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Header Subtitle</Label>
                      <Input
                        value={template.header_subtitle}
                        onChange={(e) =>
                          setTemplate({ ...template, header_subtitle: e.target.value })
                        }
                        className="h-11"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Header Font Size</Label>
                        <Input
                          type="number"
                          value={template.header_font_size}
                          onChange={(e) =>
                            setTemplate({ ...template, header_font_size: parseInt(e.target.value) })
                          }
                          className="h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Header Color</Label>
                        <Input
                          type="color"
                          value={template.header_color}
                          onChange={(e) =>
                            setTemplate({ ...template, header_color: e.target.value })
                          }
                          className="h-11"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Display Options */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b pb-2">Display Options</h3>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={template.show_member_id}
                          onChange={(e) =>
                            setTemplate({ ...template, show_member_id: e.target.checked })
                          }
                          className="w-5 h-5 rounded"
                        />
                        <span className="text-sm">Show Member ID</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={template.show_email}
                          onChange={(e) =>
                            setTemplate({ ...template, show_email: e.target.checked })
                          }
                          className="w-5 h-5 rounded"
                        />
                        <span className="text-sm">Show Email Address</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={template.show_charges_section}
                          onChange={(e) =>
                            setTemplate({ ...template, show_charges_section: e.target.checked })
                          }
                          className="w-5 h-5 rounded"
                        />
                        <span className="text-sm">Show Charges Section</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={template.show_payments_section}
                          onChange={(e) =>
                            setTemplate({ ...template, show_payments_section: e.target.checked })
                          }
                          className="w-5 h-5 rounded"
                        />
                        <span className="text-sm">Show Payments Section</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={template.show_footer}
                          onChange={(e) =>
                            setTemplate({ ...template, show_footer: e.target.checked })
                          }
                          className="w-5 h-5 rounded"
                        />
                        <span className="text-sm">Show Footer</span>
                      </label>
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b pb-2">Colors</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                        <Label
                          className="flex items-center gap-3 cursor-pointer flex-1"
                          htmlFor="charges-color"
                        >
                          <div
                            className="w-8 h-8 rounded-full border-2 border-slate-300 shadow-sm"
                            style={{ backgroundColor: template.charges_color }}
                          />
                          <span>Charges Color</span>
                        </Label>
                        <Input
                          id="charges-color"
                          type="color"
                          value={template.charges_color}
                          onChange={(e) =>
                            setTemplate({ ...template, charges_color: e.target.value })
                          }
                          className="w-16 h-8 cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                        <Label
                          className="flex items-center gap-3 cursor-pointer flex-1"
                          htmlFor="payments-color"
                        >
                          <div
                            className="w-8 h-8 rounded-full border-2 border-slate-300 shadow-sm"
                            style={{ backgroundColor: template.payments_color }}
                          />
                          <span>Payments Color</span>
                        </Label>
                        <Input
                          id="payments-color"
                          type="color"
                          value={template.payments_color}
                          onChange={(e) =>
                            setTemplate({ ...template, payments_color: e.target.value })
                          }
                          className="w-16 h-8 cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                        <Label
                          className="flex items-center gap-3 cursor-pointer flex-1"
                          htmlFor="balance-color"
                        >
                          <div
                            className="w-8 h-8 rounded-full border-2 border-slate-300 shadow-sm"
                            style={{ backgroundColor: template.balance_color }}
                          />
                          <span>Balance Owed Color</span>
                        </Label>
                        <Input
                          id="balance-color"
                          type="color"
                          value={template.balance_color}
                          onChange={(e) =>
                            setTemplate({ ...template, balance_color: e.target.value })
                          }
                          className="w-16 h-8 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Typography */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b pb-2">Typography</h3>
                    <div className="space-y-2">
                      <Label>Body Font Size</Label>
                      <Input
                        type="number"
                        value={template.body_font_size}
                        onChange={(e) =>
                          setTemplate({ ...template, body_font_size: parseInt(e.target.value) })
                        }
                        className="h-11"
                      />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b pb-2">Footer</h3>
                    <div className="space-y-2">
                      <Label>Footer Text</Label>
                      <Input
                        value={template.footer_text}
                        onChange={(e) => setTemplate({ ...template, footer_text: e.target.value })}
                        className="h-11"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-4">
                    <Button onClick={handlePreview} variant="outline" className="flex-1">
                      <Eye className="w-4 h-4 mr-2" />
                      Preview
                    </Button>
                    <Button
                      onClick={handleSave}
                      className="flex-1 bg-blue-900 hover:bg-blue-800"
                      disabled={
                        createTemplateMutation.isPending || updateTemplateMutation.isPending
                      }
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {createTemplateMutation.isPending || updateTemplateMutation.isPending
                        ? 'Saving...'
                        : 'Save Template'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Live Preview Panel */}
              <Card className="border-slate-200 shadow-lg">
                <CardHeader className="border-b border-slate-200 bg-slate-50">
                  <CardTitle>Live Preview</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div
                    className="bg-white border-2 border-slate-200 rounded-lg p-8 shadow-inner"
                    style={{ minHeight: '600px' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '30px',
                      }}
                    >
                      <div>
                        <h1
                          style={{
                            margin: 0,
                            fontSize: `${template.header_font_size}px`,
                            fontWeight: 'bold',
                            color: template.header_color,
                          }}
                        >
                          {template.header_title}
                        </h1>
                        <p
                          style={{
                            margin: '5px 0 0 0',
                            color: '#64748b',
                            fontSize: `${Math.round(template.header_font_size * 0.4)}px`,
                          }}
                        >
                          {template.header_subtitle}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '3px' }}>
                          John Doe
                        </div>
                        {template.show_member_id && (
                          <div style={{ fontSize: '10px', color: '#64748b' }}>ID: 123456</div>
                        )}
                        {template.show_email && (
                          <div style={{ fontSize: '10px', color: '#64748b' }}>john@example.com</div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        marginBottom: '20px',
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        borderLeft: `4px solid ${template.header_color}`,
                      }}
                    >
                      <div style={{ fontSize: `${template.body_font_size}px`, color: '#64748b' }}>
                        Statement Period
                      </div>
                      <div
                        style={{
                          fontSize: `${Math.round(template.body_font_size * 1.2)}px`,
                          fontWeight: 'bold',
                          color: template.header_color,
                        }}
                      >
                        December 2025
                      </div>
                    </div>
                    {template.show_charges_section && (
                      <div style={{ marginBottom: '20px' }}>
                        <h3
                          style={{
                            fontSize: `${template.body_font_size + 2}px`,
                            fontWeight: 'bold',
                            marginBottom: '10px',
                            borderBottom: `2px solid ${template.header_color}`,
                            paddingBottom: '5px',
                          }}
                        >
                          Charges
                        </h3>
                        <div
                          style={{
                            fontSize: `${template.body_font_size}px`,
                            color: template.charges_color,
                          }}
                        >
                          Sample charge: $50.00
                        </div>
                      </div>
                    )}
                    {template.show_payments_section && (
                      <div style={{ marginBottom: '20px' }}>
                        <h3
                          style={{
                            fontSize: `${template.body_font_size + 2}px`,
                            fontWeight: 'bold',
                            marginBottom: '10px',
                            borderBottom: `2px solid ${template.header_color}`,
                            paddingBottom: '5px',
                          }}
                        >
                          Payments
                        </h3>
                        <div
                          style={{
                            fontSize: `${template.body_font_size}px`,
                            color: template.payments_color,
                          }}
                        >
                          Sample payment: $25.00
                        </div>
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: '20px',
                        padding: '15px',
                        backgroundColor: '#fef3c7',
                        borderRadius: '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: `${template.body_font_size + 2}px`,
                            fontWeight: 'bold',
                          }}
                        >
                          Balance Owed
                        </span>
                        <span
                          style={{
                            fontSize: `${Math.round(template.body_font_size * 1.5)}px`,
                            fontWeight: 'bold',
                            color: template.balance_color,
                          }}
                        >
                          $25.00
                        </span>
                      </div>
                    </div>
                    {template.show_footer && (
                      <div
                        style={{
                          marginTop: '30px',
                          textAlign: 'center',
                          color: '#94a3b8',
                          fontSize: `${Math.round(template.body_font_size * 0.9)}px`,
                        }}
                      >
                        <p>{template.footer_text}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="monthly" className="mt-6">
            <Card className="border-slate-200 shadow-lg max-w-2xl">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <CardTitle>Monthly Membership Charge</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <form onSubmit={handleSaveMonthlyAmount} className="space-y-6">
                  {currentPlan && (
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="text-sm text-slate-600 mb-1">
                        Current Standard Monthly Amount
                      </div>
                      <div className="text-3xl font-bold text-slate-900">
                        ${currentPlan.standard_amount.toFixed(2)}
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="monthly_amount">Standard Monthly Amount *</Label>
                    <Input
                      id="monthly_amount"
                      type="number"
                      step="0.01"
                      value={monthlyAmount}
                      onChange={(e) => setMonthlyAmount(e.target.value)}
                      placeholder="0.00"
                      className="h-12 text-lg"
                    />
                    <p className="text-sm text-slate-500">
                      This amount will be charged to all active members monthly
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      className="bg-blue-900 hover:bg-blue-800"
                      disabled={createPlanMutation.isPending}
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {createPlanMutation.isPending
                        ? 'Saving...'
                        : currentPlan
                          ? 'Update Amount'
                          : 'Set Amount'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
