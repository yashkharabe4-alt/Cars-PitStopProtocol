const questions = [
 {id:'q1',fault:'engine',text:'What does this C code print? int a[]={2,4,6,8}; int s=0; for(int i=0;i<4;i+=2) s+=a[i]; printf("%d",s);',options:['8','10','12','20'],answer:0,difficulty:'easy'},
 {id:'q2',fault:'brake',text:'A stack performs push(3), push(5), pop(), push(7), pop(). What value does the final pop return?',options:['3','5','7','The stack is empty'],answer:2,difficulty:'easy'},
 {id:'q3',fault:'fuel',text:'A car uses 5.5 L per 100 km. About how much fuel will it use over 720 km?',options:['36.6 L','39.6 L','41.2 L','45 L'],answer:1,difficulty:'medium'},
 {id:'q4',fault:'temperature',text:'A car’s temperature is 92°C and falls by 6°C each minute. What is it after 7 minutes at that rate?',options:['44°C','48°C','50°C','56°C'],answer:2,difficulty:'medium'},
 {id:'q5',fault:'speed',text:'A 180 m train passes a pole in 12 seconds. What is its speed in km/h?',options:['45','54','60','72'],answer:1,difficulty:'medium'},
 {id:'q6',fault:'engine',text:'Find the next number: 3, 8, 18, 38, __',options:['58','68','76','78'],answer:3,difficulty:'medium'},
 {id:'q7',fault:'brake',text:'What does this Python code print? values=[10,20,30,40,50]; print(values[1:5:2])',options:['[10, 30, 50]','[20, 40]','[20, 30, 40]','[10, 20]'],answer:1,difficulty:'easy'},
 {id:'q8',fault:'fuel',text:'What does this C code print? int a[]={3,1,4,2}; int s=0; for(int i=1;i<4;i+=2) s+=a[i]; printf("%d",s);',options:['2','3','4','5'],answer:1,difficulty:'easy'},
 {id:'q9',fault:'temperature',text:'What does this Python code print? values=[12,7,5,9]; print(values[0] + values[2])',options:['12','15','17','21'],answer:2,difficulty:'easy'},
 {id:'q10',fault:'speed',text:'A linear search checks [4,8,1,6] from left to right for the value 1. How many values does it compare?',options:['1','2','3','4'],answer:2,difficulty:'easy'},
 {id:'q11',fault:'engine',text:'What does this C code print? int a[]={1,2,3}; a[1]=5; printf("%d",a[0]+a[1]+a[2]);',options:['6','8','9','10'],answer:2,difficulty:'easy'},
 {id:'q12',fault:'brake',text:'A car travels at 60 km/h for 1.5 hours. How far does it travel?',options:['60 km','80 km','90 km','100 km'],answer:2,difficulty:'easy'},
 {id:'q13',fault:'fuel',text:'What is the largest value in the array [5, 4, 9, 8]?',options:['5','4','9','8'],answer:2,difficulty:'easy'},
 {id:'q14',fault:'temperature',text:'A loop counts the values greater than 5 in [2, 8, 5, 11, 4]. What count does it produce?',options:['1','2','3','4'],answer:1,difficulty:'easy'},
 {id:'q15',fault:'speed',text:'What does this C loop sum? int a[]={3,6,2,9,5}; int s=0; for(int i=0;i<5;i+=2) s+=a[i];',options:['8','9','10','12'],answer:2,difficulty:'easy'}
];

module.exports = { questions, faultTypes: ['engine','brake','fuel','temperature','speed'] };
