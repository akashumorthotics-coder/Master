(() => {
  'use strict';
  const root = document.getElementById('soRoot');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g,' ').toLowerCase();
  const rupees = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
  const money = value => rupees.format(Number(value || 0));
  const paise = value => money(value / 100);
  const count = value => new Intl.NumberFormat('en-IN').format(value || 0);
  const dateFormat = new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'});
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? dateFormat.format(new Date(value)) : '—';
  const api = (action,payload={}) => UMAuth.api(action,payload);
  const button = (action,label,extra='',primary=false) => `<button type="button" class="so-btn${primary ? ' so-primary' : ''}" data-so-action="${action}" ${extra}>${esc(label)}</button>`;
  const optionList = (rows,selected,placeholder) => `<option value="">${esc(placeholder)}</option>` + rows.map(([key,label]) => `<option value="${esc(key)}"${key===selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const empty = (title,message) => `<div class="so-empty"><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
  const problem = message => `<div class="so-error" role="alert">${esc(message)}</div>`;
  const spinner = message => `<div class="so-loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(message)}</div>`;
  const percentOf = (amount,bp) => Math.floor(amount/10000)*bp+Math.floor(((amount%10000)*bp+5000)/10000);
  const currentUser = () => UMAuth.user?.id || '';
  const state = {uid:'',ready:false,loading:false,view:'new',masters:null,cart:[],form:{customerCode:'',poNumber:'',deliveryDate:'',shippingAddress:'',remarks:''},query:'',addQuantity:1,
    pending:null,reviewing:false,submitting:false,success:null,masterRun:0,detailRun:0,history:{filters:{},page:1,size:25,result:null,run:0,loading:false}};
  const initialForm = () => ({customerCode:'',poNumber:'',deliveryDate:'',shippingAddress:'',remarks:''});
  const active = () => document.getElementById('tab-punch-sale-order').classList.contains('active');
  const customer = () => state.masters?.customers.find(c => c.code === state.form.customerCode);
  const product = sku => state.masters?.products.find(p => p.sku === sku);
  const scoped = selector => root.querySelector(selector);
  const loadingSet = busy => {root.setAttribute('aria-busy',String(busy));};

  function dialog(id,title){
    const el=document.createElement('dialog');el.className='so-dialog';el.setAttribute('aria-labelledby',id);
    el.innerHTML=`<div class="so-dialog-head"><h3 id="${id}" tabindex="-1">${esc(title)}</h3>${button('close','Close','aria-label="Close '+esc(title)+'"')}</div><div class="so-dialog-body" data-so-dialog-body></div><div class="so-dialog-footer" data-so-dialog-footer></div>`;
    document.body.appendChild(el);return el;
  }
  const review=dialog('soReviewTitle','Review primary order'),detail=dialog('soDetailTitle','Order details');
  const bodyOf = el => el.querySelector('[data-so-dialog-body]');
  const footerOf = el => el.querySelector('[data-so-dialog-footer]');

  function header(){
    return `<div class="so-workspace-head"><div class="so-tabs" role="group" aria-label="Primary order workspace">${button('new-tab','New order',`aria-pressed="${state.view==='new'}"`)}${button('history-tab','Order history',`aria-pressed="${state.view==='history'}"`)}</div><div class="so-actions">${state.view==='new' ? button('refresh-masters','Refresh distributors & products') : button('refresh-history','Refresh orders')+button('export-history','Export Excel')}</div></div>`;
  }
  function customerInfo(){
    const c=customer();
    return c ? `<div class="so-customer-info"><strong>${esc(c.name)}</strong><span>${esc(c.code)} · ${esc([c.city,c.state].filter(Boolean).join(', '))}</span><p>${esc(c.billingAddress || 'Enter the delivery address below.')}</p><span>${c.gstin ? 'GSTIN '+esc(c.gstin)+' · ' : ''}Approved discount: ${count(c.discountBp/100)}%</span></div>` : '<p class="so-note">Choose a distributor to apply its approved pricing.</p>';
  }
  function totals(){
    const c=customer(),out={grossPaise:0,discountPaise:0,taxablePaise:0,taxPaise:0,totalPaise:0,totalQty:0,lines:[]};
    for(const item of state.cart){
      const p=product(item.sku);if(!p || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>state.masters.limits.quantity)return null;
      const gross=p.unitPricePaise*item.quantity,discount=percentOf(gross,c?.discountBp || 0),taxable=gross-discount,tax=percentOf(taxable,p.gstBp);
      const line={...item,grossPaise:gross,discountPaise:discount,taxablePaise:taxable,taxPaise:tax,totalPaise:taxable+tax};out.lines.push(line);
      for(const key of ['grossPaise','discountPaise','taxablePaise','taxPaise','totalPaise'])out[key]+=line[key];out.totalQty+=item.quantity;
    }
    return out;
  }
  function summaryMarkup(t){
    if(!t)return problem('Check product availability and quantities before reviewing the order.');
    return `<dl class="so-totals"><div><dt>Product lines</dt><dd>${count(t.lineCount ?? t.lines?.length ?? state.cart.length)}</dd></div><div><dt>Total quantity</dt><dd>${count(t.totalQty)}</dd></div><div><dt>Gross value</dt><dd>${paise(t.grossPaise)}</dd></div><div><dt>Discount</dt><dd>− ${paise(t.discountPaise)}</dd></div><div><dt>Taxable value</dt><dd>${paise(t.taxablePaise)}</dd></div><div><dt>GST</dt><dd>${paise(t.taxPaise)}</dd></div><div class="so-grand-total"><dt>Order value</dt><dd>${paise(t.totalPaise)}</dd></div></dl>`;
  }
  function renderNew(){
    const m=state.masters,f=state.form;
    const notice=state.success ? `<section class="so-success" role="status"><div><strong>Order ${esc(state.success.orderNo)} submitted</strong><p>${money(state.success.totalAmount)} recorded for processing.</p></div><div class="so-actions">${button('view-order','View order',`data-id="${esc(state.success.id)}"`)}${button('history-tab','Order history')}</div></section>` : '';
    const diagnostics=m.issues.length ? `<div class="so-master-notice">${count(m.issues.length)} active master record(s) need correction and are unavailable for ordering.${m.canManage ? '<details><summary>Review master issues</summary><ul>'+m.issues.map(i=>'<li>'+esc(i.sheet+' · '+i.key+' · '+i.message)+'</li>').join('')+'</ul></details>' : ' Contact your administrator if a distributor or product is missing.'}</div>` : '';
    const missing=!m.customers.length || !m.products.length ? `<section class="so-panel">${empty(!m.customers.length ? 'No active distributors assigned' : 'No orderable products yet',!m.customers.length ? 'Ask your administrator to add active distributors and assign your user ID and state.' : 'Ask your administrator to add active product variants with a unit price and GST percentage.')}</section>` : '';
    root.innerHTML=header()+notice+diagnostics+missing+`<form id="soOrderForm" autocomplete="off"><div class="so-order-layout"><div class="so-order-main"><section class="so-panel"><div class="so-panel-head"><h3>Distributor & delivery</h3><span class="so-pill">Primary order</span></div><div class="so-fields"><label>Distributor<select name="customerCode" required>${optionList(m.customers.map(c=>[c.code,c.code+' · '+c.name+' · '+c.state]),f.customerCode,'Select distributor')}</select></label><label>Punched by<input value="${esc(UMAuth.user?.name || UMAuth.user?.id)}" readonly aria-readonly="true"></label><div class="so-full" data-so-customer-info>${customerInfo()}</div><label>Customer PO reference<input name="poNumber" maxlength="120" value="${esc(f.poNumber)}" placeholder="Optional"></label><label>Requested delivery date<input name="deliveryDate" type="date" min="${esc(m.today)}" max="2099-12-31" value="${esc(f.deliveryDate)}"></label><label class="so-full">Delivery address<textarea name="shippingAddress" required maxlength="1000" rows="3" placeholder="Enter the delivery address">${esc(f.shippingAddress)}</textarea></label><label class="so-full">Order remarks<textarea name="remarks" maxlength="2000" rows="2" placeholder="Optional delivery or order instructions">${esc(f.remarks)}</textarea></label></div></section>
      <section class="so-panel"><div class="so-panel-head"><div><h3>Add products</h3><p class="so-note">Choose the required SKU, size and colour.</p></div></div><div class="so-product-search"><label>Find a product<input name="productSearch" type="search" value="${esc(state.query)}" placeholder="Product code, name, SKU, size or colour"></label><label>Quantity to add<input name="addQuantity" type="text" inputmode="numeric" maxlength="6" value="${state.addQuantity}"></label></div><div data-so-product-results></div></section>
      <section class="so-panel"><div class="so-panel-head"><h3>Order items</h3>${button('reset-order','Reset order')}</div><div data-so-cart></div></section></div>
      <aside class="so-summary so-panel"><h3>Order summary</h3><div data-so-summary></div><p class="so-note">Prices, discounts and GST come from the approved masters and are verified when you review.</p><button class="so-btn so-primary so-review-btn" type="submit" ${!m.customers.length || !m.products.length ? 'disabled' : ''}>Review order</button><p class="so-note">Submission records the primary order for processing. It does not confirm dispatch.</p></aside></div><div data-so-form-message></div></form>`;
    renderProducts();renderCart();
  }
  function renderProducts(){
    const box=scoped('[data-so-product-results]');if(!box)return;
    const q=norm(state.query),all=state.masters.products.filter(p=>!q || [p.sku,p.code,p.name,p.size,p.color].some(v=>norm(v).includes(q))),shown=all.slice(0,12);
    box.innerHTML=shown.length ? `<div class="so-product-count so-note">${count(all.length)} matching variants${all.length>shown.length ? ' · refine your search to see more' : ''}</div><div class="so-table-scroll" role="region" tabindex="0" aria-label="Product variants"><table class="so-table"><thead><tr><th>Product / SKU</th><th>Variant</th><th>Unit rate</th><th>GST</th><th>Action</th></tr></thead><tbody>${shown.map(p=>`<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.code+' · '+p.sku)}</small></td><td>${esc([p.size,p.color].filter(Boolean).join(' · ') || 'Standard')}<small>${esc(p.unit)}</small></td><td class="so-number">${paise(p.unitPricePaise)}</td><td class="so-number">${count(p.gstBp/100)}%</td><td>${button('add-product','Add',`data-sku="${esc(p.sku)}" aria-label="Add ${esc(p.name+' '+p.size+' '+p.color+' '+p.sku)}"`)}</td></tr>`).join('')}</tbody></table></div>` : empty('No matching products','Try another product code, name or size.');
  }
  function renderCart(){
    const box=scoped('[data-so-cart]');if(!box)return;
    const t=totals();
    box.innerHTML=state.cart.length ? `<div class="so-table-scroll" role="region" tabindex="0" aria-label="Order items"><table class="so-table"><thead><tr><th>Product / variant</th><th>Quantity</th><th>Unit rate</th><th>Line value</th><th>Remarks</th><th>Action</th></tr></thead><tbody>${state.cart.map(item=>{
      const p=product(item.sku),line=t?.lines.find(i=>i.sku===item.sku);
      return `<tr data-so-cart-row="${esc(item.sku)}"><td><strong>${esc(p?.name || item.sku)}</strong><small>${esc(p ? p.code+' · '+[p.size,p.color].filter(Boolean).join(' · ')+' · '+item.sku : 'Product unavailable. Refresh the masters.')}</small></td><td><input class="so-quantity" type="number" name="quantity" data-sku="${esc(item.sku)}" min="1" max="${state.masters.limits.quantity}" step="1" value="${item.quantity}" required aria-label="Quantity for ${esc(item.sku)}"><small>${esc(p?.unit || '')}</small></td><td class="so-number">${p ? paise(p.unitPricePaise) : 'Unavailable'}</td><td class="so-number" data-so-line-total>${line ? paise(line.totalPaise) : 'Check quantity'}</td><td><input class="so-line-remarks" name="lineNotes" data-sku="${esc(item.sku)}" maxlength="300" value="${esc(item.notes)}" aria-label="Remarks for ${esc(item.sku)}" placeholder="Optional"></td><td>${button('remove-product','Remove',`data-sku="${esc(item.sku)}"`)}</td></tr>`;
    }).join('')}</tbody></table></div>` : empty('Your order is empty','Find a product above and select Add.');
    refreshTotals();
  }
  function refreshTotals(){
    const t=totals(),box=scoped('[data-so-summary]');if(box)box.innerHTML=summaryMarkup(t);
    root.querySelectorAll('[data-so-cart-row]').forEach(row=>{const line=t?.lines.find(i=>i.sku===row.dataset.soCartRow);row.querySelector('[data-so-line-total]').textContent=line ? paise(line.totalPaise) : 'Check quantity';});
  }
  function addProduct(sku){
    const quantity=Number(scoped('[name="addQuantity"]').value),p=product(sku);
    if(!p || !Number.isInteger(quantity) || quantity<1 || quantity>state.masters.limits.quantity){showToast('Enter a valid whole quantity to add.','error');return;}
    const item=state.cart.find(i=>i.sku===sku);
    if(item && item.quantity+quantity>state.masters.limits.quantity){showToast('This SKU exceeds the quantity limit.','error');return;}
    if(!item && state.cart.length>=state.masters.limits.lines){showToast('This order already has the maximum number of product lines.','error');return;}
    if(item)item.quantity+=quantity;else state.cart.push({sku,quantity,notes:''});state.success=null;renderCart();showToast(p.name+' added.','success');
  }
  function orderInput(){return {...state.form,items:state.cart.map(i=>({sku:i.sku,quantity:i.quantity,notes:i.notes}))};}
  function uuid(){return [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function quoteTable(quote){
    return `<div class="so-table-scroll" role="region" tabindex="0" aria-label="Reviewed order items"><table class="so-table"><thead><tr><th>SKU / Product</th><th>Size / colour</th><th>Qty</th><th>Rate</th><th>Discount</th><th>GST</th><th>Line total</th></tr></thead><tbody>${quote.items.map(i=>`<tr><td><strong>${esc(i.name)}</strong><small>${esc(i.sku)}</small>${i.notes ? '<small>'+esc(i.notes)+'</small>' : ''}</td><td>${esc([i.size,i.color].filter(Boolean).join(' · ') || 'Standard')}</td><td class="so-number">${count(i.quantity)} ${esc(i.unit)}</td><td class="so-number">${paise(i.unitPricePaise)}</td><td class="so-number">${count(i.discountBp/100)}%</td><td class="so-number">${count(i.gstBp/100)}%</td><td class="so-number">${paise(i.totalPaise)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function reviewOrder(){
    if(state.reviewing || state.submitting || state.pending?.uncertain)return;
    const form=scoped('#soOrderForm');if(!form || !form.reportValidity())return;
    if(!state.cart.length){showToast('Add at least one product before reviewing.','error');return;}
    if(!totals()){showToast('Check all product quantities and availability.','error');return;}
    state.reviewing=true;const trigger=form.querySelector('button[type="submit"]');setButtonBusy(trigger,true);scoped('[data-so-form-message]').innerHTML=spinner('Verifying distributor, products and prices…');
    try{
      const response=await api('orderQuote',{input:orderInput()});
      state.pending={payload:{input:response.input,quote:response.quote,proof:response.proof,expiresAt:response.expiresAt,requestId:uuid()},uncertain:false};
      const q=response.quote;
      bodyOf(review).innerHTML=`<section class="so-review-customer"><div><span class="so-eyebrow">Primary order · ${esc(date(q.orderDate))}</span><h4>${esc(q.customer.name)}</h4><p>${esc(q.customer.code+' · '+[q.customer.city,q.customer.state].filter(Boolean).join(', '))}</p></div><div><strong>Deliver to</strong><p class="so-prewrap">${esc(q.shippingAddress)}</p>${q.deliveryDate ? '<p>Requested: '+esc(date(q.deliveryDate))+'</p>' : ''}</div></section>${q.poNumber ? '<p>Customer PO: '+esc(q.poNumber)+'</p>' : ''}${quoteTable(q)}<div class="so-review-summary">${summaryMarkup(q.totals)}</div>${q.remarks ? '<div class="so-prewrap"><strong>Order remarks</strong><p>'+esc(q.remarks)+'</p></div>' : ''}<p class="so-note">These products, quantities and prices will be recorded with your order.</p><div data-so-review-message></div>`;
      footerOf(review).innerHTML=button('back-review','Back to edit')+button('submit-order','Submit order','',true);
      if(active() && !review.open)review.showModal();
    }catch(e){scoped('[data-so-form-message]').innerHTML=problem(e.message);showToast(e.message,'error');}
    finally{state.reviewing=false;setButtonBusy(trigger,false);if(scoped('[data-so-form-message]')?.querySelector('.so-loading'))scoped('[data-so-form-message]').replaceChildren();}
  }
  async function submitOrder(){
    const pending=state.pending;if(!pending || state.submitting)return;
    state.submitting=true;review.setAttribute('aria-busy','true');review.querySelectorAll('button').forEach(b=>b.disabled=true);review.querySelector('[data-so-review-message]').innerHTML=spinner('Saving your order…');
    try{
      const result=await api('orderSubmit',pending.payload);pending.uncertain=false;state.success=result;state.pending=null;review.close();state.cart=[];state.form=initialForm();state.query='';state.history.result=null;renderNew();showToast('Order '+result.orderNo+' submitted.','success');
    }catch(e){
      const definitive=['INVALID','QUOTE_EXPIRED','PRICE_CHANGED','CUSTOMER_UNAVAILABLE','PRODUCT_UNAVAILABLE','FORBIDDEN','ORDER_SETUP','CONFLICT'].includes(e.code);
      pending.uncertain=!definitive;
      review.querySelector('[data-so-review-message]').innerHTML=problem(e.message)+(pending.uncertain ? '<p class="so-note">Submission is not yet confirmed. Retry this same request to check or finish saving it; do not create a second order.</p>' : '');
      footerOf(review).innerHTML=(pending.uncertain ? '' : button('back-review','Back to edit'))+(['QUOTE_EXPIRED','PRICE_CHANGED','CUSTOMER_UNAVAILABLE','PRODUCT_UNAVAILABLE'].includes(e.code) ? button('review-again','Review again','',true) : button('submit-order',pending.uncertain ? 'Retry submission' : 'Submit order','',true));
    }finally{state.submitting=false;review.setAttribute('aria-busy','false');review.querySelectorAll('button').forEach(b=>b.disabled=false);if(state.pending?.uncertain)review.querySelector('.so-dialog-head button').disabled=true;}
  }
  review.addEventListener('cancel',event=>{if(state.submitting || state.pending?.uncertain)event.preventDefault();});
  review.addEventListener('close',()=>{if(!review.open && !state.submitting && !state.pending?.uncertain)state.pending=null;});

  async function refreshMasters(){
    if(state.loading || state.reviewing || state.submitting || state.pending?.uncertain)return;
    const run=++state.masterRun;state.loading=true;loadingSet(true);
    if(!state.ready)root.innerHTML=spinner('Loading approved distributors and products…');
    else root.querySelectorAll('[data-so-action="refresh-masters"]').forEach(b=>b.disabled=true);
    try{
      const result=await api('orderBootstrap');if(run!==state.masterRun || state.uid!==currentUser())return;
      state.masters=result;state.ready=true;
      if(state.view==='new')renderNew();else renderHistoryShell();
    }catch(e){
      if(!state.ready)root.innerHTML=problem(e.message)+button('refresh-masters','Retry');else showToast(e.message,'error');
    }finally{if(run===state.masterRun){state.loading=false;loadingSet(false);root.querySelectorAll('[data-so-action="refresh-masters"]').forEach(b=>b.disabled=false);}}
  }
  function historyColumns(){return [['orderNo','Order number'],['orderDate','Order date'],['customerCode','Distributor code'],['customerName','Distributor'],['state','State'],['createdByName','Punched by'],['poNumber','Customer PO'],['lineCount','Lines'],['totalQty','Quantity'],['totalAmount','Order value (INR)'],['status','Status']];}
  function historyValue(order,key){return key==='orderDate' ? date(order[key]) : key==='totalAmount' ? Number(order[key]) : order[key] ?? '';}
  function renderHistoryShell(){
    const h=state.history;
    root.innerHTML=header()+`<form class="so-history-filters" id="soHistoryFilters"><label>Find an order<input name="q" type="search" maxlength="150" placeholder="Order no., distributor, or customer PO" value="${esc(h.filters.q || '')}"></label><label>From order date<input name="from" type="date" value="${esc(h.filters.from || '')}"></label><label>To order date<input name="to" type="date" value="${esc(h.filters.to || '')}"></label><label>State<select name="state">${optionList((h.result?.states || []).map(s=>[s,s]),h.filters.state || '','All permitted states')}</select></label><div class="so-actions"><button class="so-btn so-primary" type="submit">Apply</button>${button('clear-history','Clear')}</div></form><div data-so-history-message></div><div data-so-history-content></div>`;
    if(h.result)renderHistory();else loadHistory();
  }
  function renderHistory(){
    const h=state.history,r=h.result,box=scoped('[data-so-history-content]');if(!box || !r)return;
    box.innerHTML=`<div class="so-history-kpis"><article><span>Orders</span><strong>${count(r.summary.orders)}</strong></article><article><span>Order value</span><strong>${money(r.summary.totalAmount)}</strong></article><article><span>Quantity ordered</span><strong>${count(r.summary.totalQty)}</strong></article></div>`+(r.items.length ? `<section class="so-panel"><div class="so-panel-head"><h3>Submitted primary orders</h3><p class="so-note">${state.masters.canManage ? 'All orders within your permitted state scope.' : 'Orders submitted by your account.'}</p></div><div class="so-table-scroll" tabindex="0" role="region" aria-label="Primary order history"><table class="so-table"><thead><tr>${historyColumns().map(([,label])=>'<th>'+esc(label)+'</th>').join('')}<th>Action</th></tr></thead><tbody>${r.items.map(o=>'<tr>'+historyColumns().map(([key])=>'<td'+(['totalAmount','totalQty','lineCount'].includes(key)?' class="so-number"':'')+'>'+(key==='status'?'<span class="so-pill">'+esc(o.status)+'</span>':esc(key==='totalAmount'?money(o.totalAmount):historyValue(o,key)))+'</td>').join('')+'<td>'+button('view-order','View order',`data-id="${esc(o.id)}"`)+'</td></tr>').join('')}</tbody></table></div><div class="so-pager"><span class="so-note">${count(r.total)} orders · Page ${r.page} of ${r.pages}</span><div class="so-actions">${button('history-page','Previous',`data-page="${r.page-1}"${r.page<=1?' disabled':''}`)}${button('history-page','Next',`data-page="${r.page+1}"${r.page>=r.pages?' disabled':''}`)}</div></div></section>` : '<section class="so-panel">'+empty('No orders found','Submit a primary order or change the history filters.')+'</section>');
  }
  async function loadHistory(){
    if(state.view!=='history')return;
    const h=state.history,run=++h.run,box=scoped('[data-so-history-content]');if(!box)return;h.loading=true;box.innerHTML=spinner('Loading order history…');
    root.querySelectorAll('[data-so-action="export-history"],#soHistoryFilters button[type="submit"]').forEach(b=>b.disabled=true);
    try{
      const result=await api('orderList',{filters:h.filters,page:h.page,size:h.size});if(run!==h.run || state.view!=='history')return;
      h.result=result;h.page=result.page;const select=scoped('#soHistoryFilters select');select.innerHTML=optionList(result.states.map(s=>[s,s]),h.filters.state || '','All permitted states');renderHistory();
    }catch(e){if(run===h.run && state.view==='history'){box.innerHTML=problem(e.message)+button('refresh-history','Retry');h.result=null;}}
    finally{if(run===h.run && state.view==='history'){h.loading=false;root.querySelectorAll('[data-so-action="export-history"],#soHistoryFilters button[type="submit"]').forEach(b=>b.disabled=false);}}
  }
  function detailMarkup(response){
    const o=response.order;
    return `<section class="so-review-customer"><div><span class="so-eyebrow">${esc(o.type)} order · ${esc(date(o.orderDate))}</span><h4>${esc(o.customerName)}</h4><p>${esc(o.customerCode+' · '+o.state)}</p><span class="so-pill">${esc(o.status)}</span></div><div><strong>Delivery address</strong><p class="so-prewrap">${esc(o.shippingAddress)}</p>${o.deliveryDate?'<p>Requested: '+esc(date(o.deliveryDate))+'</p>':''}</div></section><p class="so-note">Punched by ${esc(o.createdByName)} · Customer PO: ${esc(o.poNumber || '—')}</p><div class="so-table-scroll" role="region" tabindex="0" aria-label="Saved order items"><table class="so-table"><thead><tr><th>SKU / Product</th><th>Variant</th><th>Qty</th><th>Rate</th><th>Discount %</th><th>GST %</th><th>Line total</th></tr></thead><tbody>${response.items.map(i=>`<tr><td><strong>${esc(i.productName)}</strong><small>${esc(i.sku)}</small>${i.notes ? '<small>'+esc(i.notes)+'</small>' : ''}</td><td>${esc([i.size,i.color].filter(Boolean).join(' · ') || 'Standard')}</td><td class="so-number">${count(i.quantity)} ${esc(i.unit)}</td><td class="so-number">${money(i.unitPrice)}</td><td class="so-number">${count(i.discountPct)}%</td><td class="so-number">${count(i.gstPct)}%</td><td class="so-number">${money(i.lineTotal)}</td></tr>`).join('')}</tbody></table></div><div class="so-review-summary">${summaryMarkup({grossPaise:Math.round(o.grossAmount*100),discountPaise:Math.round(o.discountAmount*100),taxablePaise:Math.round(o.taxableAmount*100),taxPaise:Math.round(o.taxAmount*100),totalPaise:Math.round(o.totalAmount*100),totalQty:o.totalQty,lineCount:o.lineCount})}</div>${o.remarks ? '<div class="so-prewrap"><strong>Order remarks</strong><p>'+esc(o.remarks)+'</p></div>' : ''}<section class="so-order-audit"><h4>Order activity</h4>${response.history.map(a=>'<p><strong>'+esc(a.activity)+'</strong> · '+esc(a.actorName)+' · '+esc(date(a.at))+'</p>').join('')}</section>`;
  }
  let detailResponse=null;
  async function showOrder(id){
    const run=++state.detailRun;detailResponse=null;detail.querySelector('h3').textContent='Order details';bodyOf(detail).innerHTML=spinner('Loading saved order…');footerOf(detail).innerHTML='';if(!detail.open)detail.showModal();
    try{const response=await api('orderGet',{id});if(run!==state.detailRun || !detail.open)return;detailResponse=response;detail.querySelector('h3').textContent=response.order.orderNo;bodyOf(detail).innerHTML=detailMarkup(response);footerOf(detail).innerHTML=button('download-order','Download order Excel')+button('close','Close');}
    catch(e){if(run===state.detailRun)bodyOf(detail).innerHTML=problem(e.message)+button('view-order','Retry',`data-id="${esc(id)}"`);}
  }
  detail.addEventListener('close',()=>{state.detailRun++;detailResponse=null;});
  async function workbook(name,sheetName,rows){
    await new Promise((resolve,reject)=>{
      const worker=new Worker('./lead-import-worker.js'),timer=setTimeout(()=>finish(new Error('Excel generation took too long. Try fewer orders.')),25000);
      function finish(error,result){clearTimeout(timer);worker.terminate();if(error){reject(error);return;}const url=URL.createObjectURL(new Blob([result.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);resolve();}
      worker.onmessage=({data})=>data.ok ? finish(null,data) : finish(new Error(data.message));worker.onerror=event=>{event.preventDefault();finish(new Error('The Excel tool could not load. Check the workbook worker files.'));};
      try{worker.postMessage({op:'write',sheetName,rows});}catch(e){finish(e);}
    });
  }
  async function exportHistory(trigger){
    if(state.history.loading)return;setButtonBusy(trigger,true);
    try{const result=await api('orderExport',{filters:{...state.history.filters}});if(!result.items.length){showToast('No matching orders to export.');return;}
      const columns=historyColumns();await workbook('Primary-orders-'+state.masters.today+'.xlsx','Primary orders',[columns.map(c=>c[1]),...result.items.map(o=>columns.map(([key])=>historyValue(o,key)))]);showToast(count(result.items.length)+' orders exported.','success');
    }catch(e){showToast(e.message,'error');}finally{setButtonBusy(trigger,false);}
  }
  async function downloadOrder(trigger){
    if(!detailResponse)return;const response=detailResponse,o=response.order;setButtonBusy(trigger,true);
    try{const columns=[['sku','SKU'],['productCode','Product code'],['productName','Product'],['size','Size'],['color','Color'],['unit','Unit'],['quantity','Quantity'],['unitPrice','Unit rate (INR)'],['discountPct','Discount %'],['gstPct','GST %'],['lineTotal','Line total (INR)'],['notes','Remarks']];
      await workbook(o.orderNo+'.xlsx','Order',[['Primary sales order',o.orderNo,...Array(columns.length-2).fill('')],['Distributor',o.customerName],['Distributor code',o.customerCode],['Order date',o.orderDate],['Punched by',o.createdByName],['Customer PO',o.poNumber],['Delivery address',o.shippingAddress],['Requested delivery',o.deliveryDate],[],columns.map(c=>c[1]),...response.items.map(i=>columns.map(([key])=>i[key])),[],['Gross amount (INR)',o.grossAmount],['Discount (INR)',o.discountAmount],['Taxable amount (INR)',o.taxableAmount],['GST (INR)',o.taxAmount],['Order total (INR)',o.totalAmount],['Order remarks',o.remarks]]);showToast('Order workbook downloaded.','success');
    }catch(e){showToast(e.message,'error');}finally{setButtonBusy(trigger,false);}
  }
  function onAction(event){
    const target=event.target.closest('button[data-so-action]');if(!target || target.disabled)return;const action=target.dataset.soAction;
    switch(action){
      case 'new-tab':state.view='new';state.history.run++;renderNew();break;
      case 'history-tab':state.view='history';renderHistoryShell();break;
      case 'refresh-masters':refreshMasters();break;
      case 'refresh-history':loadHistory();break;
      case 'add-product':addProduct(target.dataset.sku);break;
      case 'remove-product':state.cart=state.cart.filter(i=>i.sku!==target.dataset.sku);renderCart();break;
      case 'reset-order':state.cart=[];state.form=initialForm();state.query='';state.success=null;renderNew();break;
      case 'back-review':case 'close':if(target.closest('dialog')===review && (state.submitting || state.pending?.uncertain))return;target.closest('dialog')?.close();break;
      case 'review-again':review.close();state.pending=null;reviewOrder();break;
      case 'submit-order':submitOrder();break;
      case 'view-order':showOrder(target.dataset.id);break;
      case 'download-order':downloadOrder(target);break;
      case 'export-history':exportHistory(target);break;
      case 'history-page':state.history.page=Number(target.dataset.page);loadHistory();break;
      case 'clear-history':state.history.filters={};state.history.page=1;renderHistoryShell();loadHistory();break;
    }
  }
  root.addEventListener('click',onAction);review.addEventListener('click',onAction);detail.addEventListener('click',onAction);
  root.addEventListener('submit',event=>{
    event.preventDefault();
    if(event.target.id==='soOrderForm')reviewOrder();
    if(event.target.id==='soHistoryFilters'){state.history.filters=Object.fromEntries(new FormData(event.target));state.history.page=1;loadHistory();}
  });
  root.addEventListener('input',event=>{
    const el=event.target,key=el.name;
    if(key==='productSearch'){state.query=el.value;renderProducts();return;}
    if(key==='quantity'){const row=state.cart.find(i=>i.sku===el.dataset.sku);if(row)row.quantity=Number(el.value);refreshTotals();return;}
    if(key==='lineNotes'){const row=state.cart.find(i=>i.sku===el.dataset.sku);if(row)row.notes=el.value;return;}
    if(key==='addQuantity'){state.addQuantity=Number(el.value);return;}
    if(Object.hasOwn(state.form,key) && key!=='customerCode')state.form[key]=el.value;
  });
  root.addEventListener('change',event=>{
    if(event.target.name==='customerCode'){state.form.customerCode=event.target.value;const c=customer();state.form.shippingAddress=c?.shippingAddress || c?.billingAddress || '';scoped('[name="shippingAddress"]').value=state.form.shippingAddress;scoped('[data-so-customer-info]').innerHTML=customerInfo();refreshTotals();}
  });
  async function open(){
    if(!UMAuth.can('orders.create') && !UMAuth.can('orders.manage'))return;
    if(state.uid && state.uid!==currentUser()){state.ready=false;state.cart=[];state.form=initialForm();state.masters=null;state.history={filters:{},page:1,size:25,result:null,run:state.history.run+1,loading:false};state.success=null;}
    state.uid=currentUser();if(!state.ready){await refreshMasters();return;}
    if(state.view==='new')renderNew();else{renderHistoryShell();loadHistory();}
  }
  window.UMPrimaryOrders={open};
})();
